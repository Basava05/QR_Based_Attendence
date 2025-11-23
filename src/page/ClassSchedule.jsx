import { useState } from "react";
import Input from "../component/Input";
import MapModal from "../component/MapModal";
import axios from "axios";
import QRCodeModal from "../component/QRCodeModal";
import scheduleImg from "../../public/scheduleImg.jpg";
import logo from "../../public/trackAS.png";
import { supabase } from "../utils/supabaseClient";
import useUserDetails from "../hooks/useUserDetails";
import { QRCodeSVG } from "qrcode.react";
import toast from "react-hot-toast";
import { Link } from "react-router-dom";

const VERCEL_URL = import.meta.env.VITE_VERCEL_URL;

const ClassSchedule = () => {
  const { userDetails } = useUserDetails();

  const [formData, setFormData] = useState({
    courseTitle: "",
    courseCode: "",
    lectureVenue: "",
    time: "",
    date: "",
    note: "",
  });

  const [selectedLocationCordinate, setSelectedLocationCordinate] =
    useState(null);
  const [qrData, setQrData] = useState("");
  const [isMapModalOpen, setIsMapModalOpen] = useState(false);
  const [isQRModalOpen, setIsQRModalOpen] = useState(false);

  const handleInputChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleLocationChange = (locationName, coordinate) => {
    setFormData({ ...formData, lectureVenue: locationName });
    // normalize numbers
    setSelectedLocationCordinate({
      lat: Number(coordinate.lat),
      lng: Number(coordinate.lng),
    });
  };

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      toast.error("Geolocation is not supported by this browser.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = Number(position.coords.latitude);
        const lng = Number(position.coords.longitude);

        try {
          const resp = await axios.get("https://nominatim.openstreetmap.org/reverse", {
            params: { format: "json", lat, lon: lng },
          });
          const name = resp.data.display_name || "Current Location";
          setFormData({ ...formData, lectureVenue: name });
          setSelectedLocationCordinate({ lat, lng });
        } catch (err) {
          console.error("Reverse geocode failed:", err);
          setFormData({ ...formData, lectureVenue: "Current Location" });
          setSelectedLocationCordinate({ lat, lng });
        }
      },
      (err) => {
        toast.error(`Error getting location: ${err.message}`);
      },
      { enableHighAccuracy: true }
    );
  };

  const handleSwapCoords = () => {
    if (!selectedLocationCordinate) return;
    setSelectedLocationCordinate((prev) => ({
      lat: Number(prev.lng),
      lng: Number(prev.lat),
    }));
  };

  const lecturerId = userDetails?.lecturer_id;

  const handleSubmit = async (e) => {
    e.preventDefault();

    let locationGeography = null;
    if (selectedLocationCordinate) {
      locationGeography = `SRID=4326;POINT(${selectedLocationCordinate.lng} ${selectedLocationCordinate.lat})`;
    }

    const { courseTitle, courseCode, lectureVenue, time, date, note } =
      formData;

    const registrationLink = `${VERCEL_URL}/studentLogin?courseCode=${encodeURIComponent(
      courseCode
    )}&time=${encodeURIComponent(time)}&lectureVenue=${encodeURIComponent(
      lectureVenue
    )}&lat=${selectedLocationCordinate?.lat}&lng=${
      selectedLocationCordinate?.lng
    }`;

    // Generate QR code with registration link
    const qrCodeDataUrl = await new Promise((resolve) => {
      const svg = document.createElement("div");
      const qrCode = <QRCodeSVG value={registrationLink} size={256} />;
      import("react-dom/client").then((ReactDOM) => {
        ReactDOM.createRoot(svg).render(qrCode);
        setTimeout(() => {
          const svgString = new XMLSerializer().serializeToString(
            svg.querySelector("svg")
          );
          const dataUrl = `data:image/svg+xml;base64,${btoa(svgString)}`;
          resolve(dataUrl);
        }, 0);
      });
    });

    // Save the data to Supabase
    const { data, error } = await supabase
      .from("classes")
      .insert([
        {
          course_title: courseTitle,
          course_code: courseCode,
          time: new Date(`${date}T${time}`).toISOString(),
          date: new Date(date).toISOString(),
          location: locationGeography,
          note: note,
          qr_code: qrCodeDataUrl,
          lecturer_id: lecturerId,
          location_name: lectureVenue,
        },
      ])
      .select("course_id");

    if (error) {
      toast.error(`Error inserting class schedule data, ${error.message}`);
      console.error("Error inserting data:", error);
    } else {
      toast.success("Class schedule created successfully");

        // Extract and use the generated course_id. If insert didn't return an id, try to find it.
        let returnedRow = data && data[0] ? data[0] : null;
        let generatedCourseId = returnedRow?.course_id ?? returnedRow?.id ?? null;
        if (!generatedCourseId) {
          console.debug("Insert did not return course id, searching for row...", { courseCode, time, lecturerId });
          try {
            const { data: found, error: findErr } = await supabase
              .from("classes")
              .select("course_id")
              .eq("course_code", courseCode)
              .eq("time", new Date(`${date}T${time}`).toISOString())
              .eq("lecturer_id", lecturerId)
              .limit(1)
              .single();
            if (!findErr && found) {
              generatedCourseId = found.course_id ?? found.id ?? generatedCourseId;
            } else {
              console.debug("Could not find inserted class row:", findErr);
            }
          } catch (e) {
            console.debug("Error while attempting to lookup created class:", e);
          }
        }

        // Choose base URL: prefer the current browser origin (localhost during dev),
        // falling back to VERCEL_URL when origin isn't available.
        const baseUrl = (typeof window !== "undefined" && window.location && window.location.origin)
          ? window.location.origin
          : (VERCEL_URL || "");

        const updatedRegistrationLink = `${baseUrl}/attendance?${new URLSearchParams({
          courseId: generatedCourseId == null ? "" : String(generatedCourseId),
          time: time || "",
          courseCode: courseCode || "",
          lat: selectedLocationCordinate?.lat ? String(selectedLocationCordinate.lat) : "",
          lng: selectedLocationCordinate?.lng ? String(selectedLocationCordinate.lng) : "",
        }).toString()}`;

        console.debug("Generated registration link:", updatedRegistrationLink, "generatedCourseId:", generatedCourseId);

      // Set the QR code data and open the QR modal
      setQrData(updatedRegistrationLink);
      setIsQRModalOpen(true);
    }
  };

  return (
    <>
      <div className="flex flex-col  md:flex-row max-h-[100vh]  bg-gray-100 ">
        <div className="w-full md:w-1/2 p-4 md:p-4 flex flex-col justify-center relative">
          <div>
            <Link to="/classDetails">
              <button className="btn btn-sm rounded-full bg-blue-500 border-none text-white">
                Back
              </button>
            </Link>
          </div>

          <div className="w-full max-w-2xl h-[90vh] overflow-y-auto">
            <div className="items-center flex self-center justify-center">
              <img src={logo} alt="logo" />
            </div>

            <p className="text-sm text-neutral-600 text-center mb-1">
              Schedule a class using the form below
            </p>
            <form onSubmit={handleSubmit} className="py-0">
              <Input
                label="Course Title"
                name="courseTitle"
                type="text"
                onChange={handleInputChange}
                value={formData.courseTitle}
                required={true}
              />
              <Input
                label="Course Code"
                name="courseCode"
                type="text"
                onChange={handleInputChange}
                value={formData.courseCode}
                required={true}
              />

              <div className="relative">
                <Input
                  label="Lecture Venue"
                  name="lectureVenue"
                  type="text"
                  placeholder="kindly select location"
                  value={formData.lectureVenue}
                  readOnly
                  required={true}
                />
                <div className="absolute right-0 top-9 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setIsMapModalOpen(true)}
                    className="btn px-3 bg-green-500 text-white rounded-r-md hover:bg-green-600 transition-colors"
                  >
                    Select Location
                  </button>
                  <button
                    type="button"
                    onClick={handleUseMyLocation}
                    className="btn px-3 bg-indigo-500 text-white rounded-r-md hover:bg-indigo-600 transition-colors"
                  >
                    Use My Current Location
                  </button>
                </div>
              </div>
              {selectedLocationCordinate && (
                <div className="mt-2 text-sm text-neutral-700">
                  <div>
                    <b>Selected coords:</b> Lat: {selectedLocationCordinate.lat}, Lng: {selectedLocationCordinate.lng}
                  </div>
                  <div className="mt-1">
                    <button type="button" onClick={handleSwapCoords} className="btn btn-xs bg-yellow-500 text-white">Swap coords</button>
                  </div>
                </div>
              )}
              <Input
                name="time"
                type="time"
                label="Time"
                onChange={handleInputChange}
                value={formData.time}
                required={true}
              />
              <Input
                name="date"
                type="date"
                label="Date"
                onChange={handleInputChange}
                value={formData.date}
                required={true}
              />
              <Input
                label="Note"
                name="note"
                type="text"
                onChange={handleInputChange}
                value={formData.note}
              />
              <button
                type="submit"
                className="w-full btn bg-blue-500 text-white hover:bg-blue-600 transition-colors mt-4"
              >
                Generate QR Code
              </button>
            </form>
          </div>
        </div>

        <div className="hidden md:flex w-1/2 h-screen items-center justify-center overflow-hidden">
          <img
            src={scheduleImg}
            alt="Student"
            className="object-cover w-full h-full max-w-none"
          />
        </div>

        {isMapModalOpen && (
          <MapModal
            onClose={() => setIsMapModalOpen(false)}
            onSelectLocation={handleLocationChange}
            initialPosition={selectedLocationCordinate}
          />
        )}

        {isQRModalOpen && (
          <QRCodeModal
            qrData={qrData}
            onClose={() => setIsQRModalOpen(false)}
          />
        )}
      </div>
    </>
  );
};

export default ClassSchedule;
