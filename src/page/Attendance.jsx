import { useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { calculateDistance } from "../utils/distanceCalculation";
import Input from "../component/Input";
import { supabase } from "../utils/supabaseClient";
import toast from "react-hot-toast";
import Spinner from "../component/Spinner";
import dayjs from "dayjs";
import logo from "../../public/trackAS.png";

const StudentLogin = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const queryParams = new URLSearchParams(location.search);

  const [isLoading, setIsLoading] = useState(false);

  const [userDistance, setUserDistance] = useState(null);
  const [isWithinRange, setIsWithinRange] = useState(false);
  const [classDetails, setClassDetails] = useState(null);
  const [matricNumber, setMatricNumber] = useState("");
  const [name, setName] = useState("");
  const [userCoords, setUserCoords] = useState(null);
  const [targetCoords, setTargetCoords] = useState(null);
  const [thresholdMeters, setThresholdMeters] = useState(20);
  const [autoSwapEnabled, setAutoSwapEnabled] = useState(true);

  const courseId = queryParams.get("courseId");
  const courseCode = queryParams.get("courseCode");
  const lat = parseFloat(queryParams.get("lat"));
  const lng = parseFloat(queryParams.get("lng"));

  useEffect(() => {
    const fetchClassDetails = async () => {
      const { data, error } = await supabase
        .from("classes")
        .select("*")
        .eq("course_id", courseId)
        .single();

      if (error) {
        console.error("Error fetching class details:", error);
      } else {
        setClassDetails(data);
        // parse stored location field
        const rawLocation = data?.location;
        console.debug("Fetched raw stored location:", rawLocation);
        const parsed = parsePoint(rawLocation);
        console.debug("Parsed target coords:", parsed);
        setTargetCoords(parsed);
      }
    };

    fetchClassDetails();
  }, [courseId]);

  // Parse SRID=4326;POINT(lng lat) or GeoJSON-like shapes
  function parsePoint(raw) {
    if (!raw) return null;
    try {
      if (typeof raw === "string") {
        const sridMatch = raw.match(/SRID=\d+;POINT\(([-0-9.]+)\s+([-0-9.]+)\)/i);
        if (sridMatch) {
          const lng = parseFloat(sridMatch[1]);
          const lat = parseFloat(sridMatch[2]);
          return { lat, lng };
        }

        // Try JSON parse for GeoJSON
        const json = JSON.parse(raw);
        if (json && json.coordinates) {
          return { lat: Number(json.coordinates[1]), lng: Number(json.coordinates[0]) };
        }
      } else if (typeof raw === "object") {
        if (raw.coordinates) return { lat: Number(raw.coordinates[1]), lng: Number(raw.coordinates[0]) };
        if (raw.lat != null && raw.lng != null) return { lat: Number(raw.lat), lng: Number(raw.lng) };
      }
    } catch (e) {
      console.debug("parsePoint error:", e);
    }
    return null;
  }

  useEffect(() => {
    const getUserLocation = () => {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const userLat = Number(position.coords.latitude);
            const userLng = Number(position.coords.longitude);
            setUserCoords({ lat: userLat, lng: userLng });

            // compute distance to target coords, with auto-swap heuristic
            let t = targetCoords ?? (lat != null && lng != null ? { lat: Number(lat), lng: Number(lng) } : null);
            if (!t) {
              setUserDistance(null);
              setIsWithinRange(false);
              return;
            }

            const d1 = calculateDistance(userLat, userLng, t.lat, t.lng);
            const dSwapped = calculateDistance(userLat, userLng, t.lng, t.lat);
            console.debug("Distance normal:", d1, "Distance swapped:", dSwapped);

            if (autoSwapEnabled && dSwapped < d1) {
              // adopt swapped coords
              t = { lat: Number(t.lng), lng: Number(t.lat) };
              console.debug("Adopting swapped target coords:", t);
            }

            setTargetCoords(t);
            const distance = calculateDistance(userLat, userLng, t.lat, t.lng);
            setUserDistance(distance);

            // Check if the distance is within thresholdMeters
            setIsWithinRange(distance <= Number(thresholdMeters));
          },
          (error) => {
            toast.error(`Error getting user location., ${error.message}`);
          }
        );
      } else {
        toast.error("Geolocation is not supported by this browser.");
      }
    };

    getUserLocation();
  }, [lat, lng, targetCoords, thresholdMeters, autoSwapEnabled]);

  const handleRegister = async (e) => {
    e.preventDefault();

    if (!matricNumber) {
      toast.error("Matriculation number is required.");
      return;
    }

    setIsLoading(true);

    const { data, error } = await supabase
      .from("classes")
      .select("attendees")
      .eq("course_id", courseId)
      .single();

    if (error) {
      toast.error(`Error fetching class data: ${error.message}`);
      setIsLoading(false);
      return;
    }

    const { attendees = [] } = data;

    // Check if the matriculation number already exists
    const matricNumberExists = attendees.some(
      (attendee) => attendee.matric_no === matricNumber.trim().toUpperCase()
    );

    if (matricNumberExists) {
      toast.error("This matriculation number has already been registered.");
      setIsLoading(false);
      return;
    }

    const newAttendee = {
      matric_no: matricNumber.trim().toUpperCase(),
      name: name.toUpperCase(),
      timestamp: new Date().toISOString(),
    };

    const updatedAttendees = [...attendees, newAttendee];

    const { error: updateError } = await supabase
      .from("classes")
      .update({ attendees: updatedAttendees })
      .eq("course_id", courseId);

    if (updateError) {
      toast.error(`Error marking attendance: ${updateError.message}`);
    } else {
      toast.success("Attendance marked successfully.");

      // Clear input fields
      setMatricNumber("");
      setName("");
      setIsLoading(false);

      // Redirect to success page
      navigate("/success", { replace: true });
    }
  };

  return (
    <section className="studentLogin h-screen grid place-items-center ">
      <div className="bg-white px-6 py-4 md:px-16 max-w-3xl  rounded-xl">
        <div className="items-center flex self-center justify-center">
          <img src={logo} alt="logo" />
        </div>
        <h2 className="text-[2.5rem] text-[#000D46] text-center font-bold mb-2">
          TrackAS
        </h2>
        {classDetails && (
          <div className="flex justify-between items-center">
            <div>
              <div className="text-[#000D46] font-bold">Title {classDetails.course_title}</div>

              <div className="text-[#000D46]  font-bold">Code: {courseCode}</div>

              <div className="mt-2">
                <div className="text-[#000D46]  font-bold">Venue: {classDetails.location_name}</div>
                <div className="text-[#000D46]  font-bold">Date: {dayjs(classDetails.date).format("DD MMMM, YYYY")}</div>
                <div className="text-[#000D46]  font-bold">Time: {new Date(classDetails.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true })}</div>
                <div className="text-[#000D46] mb-2 text-lg font-bold">Note: {classDetails.note}</div>
                <div>Distance to Lecture Venue: {userDistance ? `${userDistance.toFixed(2)} meters` : "Calculating..."}</div>
              </div>
            </div>
          </div>
        )}

        <div className="mt-4 mb-4">
          <div className="text-sm mb-2">
            <b>Your coords:</b> {userCoords ? `${userCoords.lat.toFixed(6)}, ${userCoords.lng.toFixed(6)}` : "unknown"}
          </div>
          <div className="text-sm">
            <b>Target coords:</b> {targetCoords ? `${targetCoords.lat.toFixed(6)}, ${targetCoords.lng.toFixed(6)}` : "unknown"}
          </div>

          <div className="mt-2 flex gap-2 items-center">
            <label className="text-sm">Threshold meters:</label>
            <input type="number" value={thresholdMeters} onChange={(e) => setThresholdMeters(Number(e.target.value))} className="input input-sm w-24" />
            <label className="ml-4 text-sm">Auto-swap:</label>
            <input type="checkbox" checked={autoSwapEnabled} onChange={(e) => setAutoSwapEnabled(e.target.checked)} />
          </div>
        </div>
        <form onSubmit={handleRegister}>
          <Input
            type="text"
            name="name"
            label="Name"
            placeholder={"Enter your name"}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <Input
            type="text"
            name="matricNumber"
            label="Matriculation Number"
            placeholder={"Your matriculation number"}
            value={matricNumber}
            onChange={(e) => setMatricNumber(e.target.value)}
          />

          {isWithinRange ? (
            <button className="btn my-5 btn-block text-lg" type="submit">
              {isLoading ? <Spinner /> : "Mark Attendance"}
            </button>
          ) : (
            <p className="text-xs text-red-500 pt-2">
              You must be within 20 meters of the lecture venue to register.
            </p>
          )}
        </form>
      </div>
    </section>
  );
};

export default StudentLogin;
