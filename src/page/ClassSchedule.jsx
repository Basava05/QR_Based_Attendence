import { useState } from "react";
import Input from "../component/Input";
import MapModal from "../component/MapModal";
import QRCodeModal from "../component/QRCodeModal";
import scheduleImg from "../../public/scheduleImg.jpg";
import logo from "../../public/trackAS.png";
import { supabase } from "../utils/supabaseClient";
import useUserDetails from "../hooks/useUserDetails";
import { QRCodeSVG } from "qrcode.react";
import toast from "react-hot-toast";
import { Link } from "react-router-dom";

const VERCEL_URL = import.meta.env.VITE_VERCEL_URL;
const LOCAL_URL = import.meta.env.VITE_LOCALHOST_URL;

const getBaseUrl = () => {
  if (VERCEL_URL && VERCEL_URL !== "your_vercel_app_url") return VERCEL_URL;
  if (LOCAL_URL) return LOCAL_URL;
  if (typeof window !== "undefined" && window.location && window.location.origin)
    return window.location.origin;
  return "http://localhost:5173";
};

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
  const [getLocationLoading, setGetLocationLoading] = useState(false);

  const handleInputChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleLocationChange = (locationName, coordinate) => {
    setFormData({ ...formData, lectureVenue: locationName });
    // Normalize coordinate values to numbers and ensure shape { lat, lng }
    const lat = Number(coordinate?.lat);
    const lng = Number(coordinate?.lng);
    setSelectedLocationCordinate({ lat, lng });
  };

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      toast.error("Geolocation is not supported by this browser.");
      return;
    }

    setGetLocationLoading(true);

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const lat = Number(pos.coords.latitude);
          const lng = Number(pos.coords.longitude);

          // Reverse geocode with Nominatim
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`,
            {
              headers: { "User-Agent": "TrackAS/1.0 (contact@local)" },
            }
          );
          const json = await res.json();
          const displayName = json?.display_name || `Lat ${lat}, Lng ${lng}`;

          setFormData((fd) => ({ ...fd, lectureVenue: displayName }));
          setSelectedLocationCordinate({ lat, lng });
          toast.success("Location set from your device.");
        } catch (err) {
          console.error("Reverse geocode failed:", err);
          toast.error("Failed to reverse-geocode your location.");
        } finally {
          setGetLocationLoading(false);
        }
      },
      (err) => {
        console.error("Geolocation error:", err);
        toast.error(`Unable to get your location: ${err.message}`);
        setGetLocationLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const swapSelectedCoords = () => {
    if (!selectedLocationCordinate) return;
    const { lat, lng } = selectedLocationCordinate;
    setSelectedLocationCordinate({ lat: Number(lng), lng: Number(lat) });
  };

  const lecturerId = userDetails?.lecturer_id;

  const handleSubmit = async (e) => {
    e.preventDefault();

    let locationGeography = null;
    if (selectedLocationCordinate) {
      // Ensure numeric ordering: PostGIS EWKT expects POINT(lng lat)
      const lat = Number(selectedLocationCordinate.lat);
      const lng = Number(selectedLocationCordinate.lng);

      // Basic sanity check: if lat is out of range, attempt to swap
      const isLatValid = Number.isFinite(lat) && lat >= -90 && lat <= 90;
      const isLngValid = Number.isFinite(lng) && lng >= -180 && lng <= 180;
      let finalLat = lat;
      let finalLng = lng;
      if (!isLatValid && isLngValid) {
        // Likely swapped
        finalLat = lng;
        finalLng = lat;
        console.warn("Swapped lat/lng before storing due to sanity check");
      }

      locationGeography = `SRID=4326;POINT(${finalLng} ${finalLat})`;
    }

    const { courseTitle, courseCode, lectureVenue, time, date, note } =
      formData;

    const base = getBaseUrl();
    const registrationLink = `${base}/studentLogin?courseCode=${encodeURIComponent(
      courseCode
    )}&time=${encodeURIComponent(time)}&lectureVenue=${encodeURIComponent(
      lectureVenue
    )}&lat=${encodeURIComponent(selectedLocationCordinate?.lat)}&lng=${encodeURIComponent(
      selectedLocationCordinate?.lng
    )}`;

    // Use the registration link as the QR payload (simpler and more reliable)
    const qrPayload = registrationLink;

    // Save the data to Supabase (request all returned columns)
    let data, error;
    try {
      const res = await supabase.from("classes").insert([
        {
          course_title: courseTitle,
          course_code: courseCode,
          time: new Date(`${date}T${time}`).toISOString(),
          date: new Date(date).toISOString(),
          location: locationGeography,
          note: note,
          qr_code: qrPayload,
          lecturer_id: lecturerId,
          location_name: lectureVenue,
        },
      ]).select();
      data = res.data;
      error = res.error;
    } catch (err) {
      console.error(err);
      toast.error(`Error inserting class schedule data, ${err.message}`);
      return;
    }

    if (error) {
      toast.error(`Error inserting class schedule data, ${error.message}`);
      console.error("Error inserting data:", error);
    } else {
      toast.success("Class schedule created successfully");

      // Support both `course_id` and `id` primary key naming.
      const generatedCourseId = data?.[0]?.course_id ?? data?.[0]?.id ?? null;

      if (!generatedCourseId) {
        toast.error("Could not determine generated course id after insert.");
        console.error("Insert returned no primary key:", data);
        return;
      }

      const updatedRegistrationLink = `${base}/attendance?courseId=${encodeURIComponent(
        generatedCourseId
      )}&time=${encodeURIComponent(time)}&courseCode=${encodeURIComponent(
        courseCode
      )}&lat=${encodeURIComponent(selectedLocationCordinate?.lat)}&lng=${encodeURIComponent(
        selectedLocationCordinate?.lng
      )}`;

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
                <button
                  type="button"
                  onClick={() => setIsMapModalOpen(true)}
                  className="btn absolute right-0 top-9 px-3 bg-green-500 text-white rounded-r-md hover:bg-green-600 transition-colors"
                >
                  Select Location
                </button>
              </div>

              <div className="mt-2">
                <button
                  type="button"
                  onClick={handleUseMyLocation}
                  className={`btn btn-sm mr-2 ${getLocationLoading ? 'bg-gray-400' : 'bg-indigo-500 hover:bg-indigo-600'} text-white px-3 py-1 rounded`}
                  disabled={getLocationLoading}
                >
                  {getLocationLoading ? 'Detecting...' : 'Use My Current Location'}
                </button>
                <span className="text-xs text-neutral-500">Or select location on map</span>
              </div>

              {selectedLocationCordinate && (
                <div className="mb-3 text-sm text-neutral-700">
                  <p>
                    <strong>Selected coords:</strong> Lat: {selectedLocationCordinate.lat}, Lng: {selectedLocationCordinate.lng}
                  </p>
                  <div className="mt-2">
                    <button type="button" onClick={swapSelectedCoords} className="btn btn-sm mr-2 bg-yellow-400 text-black px-3 py-1 rounded">Swap coords</button>
                    <span className="text-xs text-neutral-500">Click to swap if latitude/longitude appear reversed.</span>
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
