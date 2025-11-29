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
  const [userCoords, setUserCoords] = useState(null);
  const [targetCoords, setTargetCoords] = useState(null);
  const [thresholdMeters, setThresholdMeters] = useState(200);
  const [autoSwapEnabled, setAutoSwapEnabled] = useState(true);
  const [matricNumber, setMatricNumber] = useState("");
  const [name, setName] = useState("");

  const courseId = queryParams.get("courseId");
  const courseCode = queryParams.get("courseCode");
  const lat = parseFloat(queryParams.get("lat"));
  const lng = parseFloat(queryParams.get("lng"));
  const DISTANCE_THRESHOLD_METERS = 200; // allow larger radius for convenience

  /////////////////////////////////////////////////////////////////////////
function parsePostgisPoint(raw) {
  if (!raw) return null;
  const match = raw.match(/POINT\(([-0-9.]+)\s+([-0-9.]+)\)/);
  if (!match) return null;
  return {
    lng: parseFloat(match[1]),
    lat: parseFloat(match[2]),
  };
}


 /////////////////////////////////////////////////////////////////////////////

  useEffect(() => {
    const fetchClassDetails = async () => {
      console.debug("fetchClassDetails: params", { courseId, courseCode });
      // Try course_id then id (some DBs return id as PK)
      let { data, error } = await supabase
        .from("classes")
        .select("*")
        .eq("course_id", courseId)
        .single();

      if (error || !data) {
        const res = await supabase
          .from("classes")
          .select("*")
          .eq("id", courseId)
          .single();
        data = res.data;
        error = res.error;
      }

      // If still not found but a courseCode query param exists (older QR links may use courseCode), try fetching by course_code
      if ((!data || error) && courseCode) {
        try {
          const resByCode = await supabase
            .from("classes")
            .select("*")
            .eq("course_code", courseCode)
            .order("created_at", { ascending: false })
            .limit(1);
          if (!resByCode.error && Array.isArray(resByCode.data) && resByCode.data.length > 0) {
            data = resByCode.data[0];
            error = null;
          }
        } catch (e) {
          console.warn("fetch by course_code failed", e);
        }
      }

      if (error) {
        console.error("Error fetching class details:", error, { courseId, courseCode });
      } else {
        setClassDetails(data);
        // Debug: show raw stored location and parsed coords
        try {
          const parsed = parsePostgisPoint(String(data?.location || ""));
          console.debug("Fetched class details location:", { raw: data?.location, parsed });
        } catch (e) {
          console.debug("Fetched class details (no location to parse)");
        }
      }
    };

    fetchClassDetails();
  }, [courseId]);

  useEffect(() => {
    const getUserLocation = () => {
      if (!navigator.geolocation) {
        toast.error("Geolocation is not supported by this browser.");
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const userLat = position.coords.latitude;
          const userLng = position.coords.longitude;
          setUserCoords({ lat: userLat, lng: userLng });

          // Determine target coordinates: prefer query params, fallback to stored class location
          let targetLat = Number.isFinite(lat) ? lat : NaN;
          let targetLng = Number.isFinite(lng) ? lng : NaN;

          const parsePointLocation = (loc) => {
            if (!loc) return null;
            try {
              // Handle PostGIS text like: SRID=4326;POINT(lng lat)
              const m = String(loc).match(/POINT\((-?[0-9.]+)\s+(-?[0-9.]+)\)/i);
              if (m) return { lng: parseFloat(m[1]), lat: parseFloat(m[2]) };
              // Try JSON/GeoJSON
              const obj = typeof loc === "object" ? loc : JSON.parse(String(loc));
              if (obj?.coordinates && Array.isArray(obj.coordinates)) {
                return { lng: obj.coordinates[0], lat: obj.coordinates[1] };
              }
            } catch (e) {
              // ignore parse errors
            }
            return null;
          };

          if (!Number.isFinite(targetLat) || !Number.isFinite(targetLng)) {
            const parsed = parsePointLocation(classDetails?.location || classDetails?.geom || classDetails?.position);
            if (parsed) {
              targetLat = parsed.lat;
              targetLng = parsed.lng;
            }
          }

          if (!Number.isFinite(targetLat) || !Number.isFinite(targetLng)) {
            // Cannot compute distance without valid lecture coordinates
            console.warn("Lecture coordinates unavailable", { lat, lng, classLocation: classDetails?.location });
            setUserDistance(null);
            setIsWithinRange(false);
            return;
          }

          setTargetCoords({ lat: targetLat, lng: targetLng });

          const computeAndSetDistance = (uLat, uLng, tLat, tLng) => {
            let dist = calculateDistance(uLat, uLng, tLat, tLng);

            if (autoSwapEnabled && dist > 5000) {
              const swappedDistance = calculateDistance(uLat, uLng, tLng, tLat);
              console.debug("Distance swap check", { dist, swappedDistance });
              if (swappedDistance < dist) {
                console.warn("Adopting swapped lecture coordinates (lat/lng were reversed)");
                dist = swappedDistance;
                // swap target coords for UI consistency
                setTargetCoords({ lat: tLng, lng: tLat });
                return { distance: dist, correctedLat: tLng, correctedLng: tLat };
              }
            }

            return { distance: dist, correctedLat: tLat, correctedLng: tLng };
          };

          const result = computeAndSetDistance(userLat, userLng, targetLat, targetLng);
          console.debug("Distance calc", { userLat, userLng, targetLat: result.correctedLat, targetLng: result.correctedLng, distance: result.distance });
          setUserDistance(result.distance);
          setIsWithinRange(result.distance <= thresholdMeters);
        },
        (error) => {
          toast.error(`Error getting user location., ${error.message}`);
        }
      );
    };

    getUserLocation();
  }, [lat, lng]);

  const handleRegister = async (e) => {
    e.preventDefault();

    if (!matricNumber) {
      toast.error("Matriculation number is required.");
      return;
    }

    setIsLoading(true);

    // Try to fetch attendees by course_id, fallback to id (UUID PK)
    let { data, error } = await supabase
      .from("classes")
      .select("attendees")
      .eq("course_id", courseId)
      .single();

    let idField = "course_id";

    if (error || !data) {
      const res = await supabase
        .from("classes")
        .select("attendees")
        .eq("id", courseId)
        .single();
      data = res.data;
      error = res.error;
      idField = "id";
    }

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

    // Update using the same identifier field we fetched with
    const updateQuery = supabase.from("classes").update({ attendees: updatedAttendees });
    const { error: updateError } = await (idField === "course_id"
      ? updateQuery.eq("course_id", courseId)
      : updateQuery.eq("id", courseId));

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
              <p className="text-[#000D46] font-bold">
                Title {classDetails.course_title}
              </p>

              <p className="text-[#000D46]  font-bold">Code: {courseCode}</p>

              <div>
                <p className="text-[#000D46]  font-bold">
                  Venue: {classDetails.location_name}
                </p>
                <p className="text-[#000D46]  font-bold">
                  Date: {dayjs(classDetails.date).format("DD MMMM, YYYY")}
                </p>
                <p className="text-[#000D46]  font-bold">
                  Time:{" "}
                  {new Date(classDetails.time).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: true,
                  })}
                </p>
                <p className="text-[#000D46] mb-2 text-lg font-bold">
                  Note: {classDetails.note}
                </p>
                <p>
                  Distance to Lecture Venue: {" "}
                  {typeof userDistance === "number"
                    ? `${userDistance.toFixed(2)} meters`
                    : "Calculating..."}
                </p>
                <div className="mt-2 text-xs text-neutral-600">
                  <p><strong>Your coords:</strong> {userCoords ? `${userCoords.lat}, ${userCoords.lng}` : 'waiting for GPS'}</p>
                  <p><strong>Target coords:</strong> {targetCoords ? `${targetCoords.lat}, ${targetCoords.lng}` : (queryParams.get('lat') || queryParams.get('lng') ? `${queryParams.get('lat') || '-'}, ${queryParams.get('lng') || '-'}` : (classDetails?.location || 'no stored location'))}</p>
                  <p><strong>Raw stored location:</strong> {classDetails?.location || 'n/a'}</p>

                  <div className="mt-2">
                    <label className="text-xs mr-2">Distance threshold (meters):</label>
                    <input
                      type="number"
                      value={thresholdMeters}
                      onChange={(e) => setThresholdMeters(Number(e.target.value || 0))}
                      className="border px-2 py-1 rounded w-24 text-xs"
                    />
                    <label className="ml-4 text-xs">
                      <input
                        type="checkbox"
                        checked={autoSwapEnabled}
                        onChange={(e) => setAutoSwapEnabled(!!e.target.checked)}
                        className="mr-1"
                      />
                      Auto-swap coords if distance looks wrong
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
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
              You must be within {thresholdMeters} meters of the lecture venue to register.
            </p>
          )}
        </form>
      </div>
    </section>
  );
};

export default StudentLogin;
