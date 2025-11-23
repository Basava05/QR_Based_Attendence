/* eslint-disable react/prop-types */
import { useState, useEffect, useRef } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import axios from "axios";
import L from "leaflet";

// Fix for default marker icon
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

const MapModal = ({ onClose, onSelectLocation, initialPosition }) => {
  const [loading, setLoading] = useState(false);
  const [selectedPosition, setSelectedPosition] = useState(null);
  const [locationName, setLocationName] = useState("");
  const markerRef = useRef(null);

  const reverseGeocode = async (lat, lng) => {
    setLoading(true);
    try {
      const response = await axios.get(
        `https://nominatim.openstreetmap.org/reverse`,
        {
          params: {
            format: "json",
            lat: lat,
            lon: lng,
          },
        }
      );
      return response.data.display_name;
    } catch (error) {
      console.error("Reverse geocoding failed:", error);
      return "Unknown location";
    } finally {
      setLoading(false);
    }
  };

  const MapEvents = () => {
    const map = useMap();

    useEffect(() => {
      if (!map) return;

      const handleClick = async (e) => {
        const { lat, lng } = e.latlng;
        // normalize numbers and set selected position, but DO NOT emit to parent yet
        const nLat = Number(lat);
        const nLng = Number(lng);
        setSelectedPosition({ lat: nLat, lng: nLng });
        const name = await reverseGeocode(nLat, nLng);
        setLocationName(name);

        // Remove existing marker if any
        if (markerRef.current) {
          markerRef.current.remove();
        }

        // Create a new marker with a permanent popup
        const marker = L.marker([nLat, nLng]).addTo(map);
        const popupContent = `
          <div>
            <div>${name}</div>
          </div>
        `;
        marker
          .bindPopup(popupContent, { autoClose: false, closeOnClick: false })
          .openPopup();

        // Store the marker reference
        markerRef.current = marker;

        // Center the map on the new marker
        map.setView([nLat, nLng]);
      };

      map.on("click", handleClick);

      return () => {
        map.off("click", handleClick);
      };
    }, [map]);

    // Watch for selectedPosition (including initialPosition prefill) and render marker
    useEffect(() => {
      if (!map) return;
      if (!selectedPosition) return;

      const { lat, lng } = selectedPosition;

      // Remove existing marker if any
      if (markerRef.current) {
        markerRef.current.remove();
      }

      const marker = L.marker([lat, lng]).addTo(map);
      const popupContent = `
        <div>
          <div>${locationName || "Selected location"}</div>
        </div>
      `;
      marker
        .bindPopup(popupContent, { autoClose: false, closeOnClick: false })
        .openPopup();

      markerRef.current = marker;
      map.setView([lat, lng]);

      return () => {
        if (markerRef.current) {
          markerRef.current.remove();
          markerRef.current = null;
        }
      };
    }, [map, selectedPosition, locationName]);

    return null;
  };

  const handleConfirm = () => {
    if (selectedPosition) {
      // normalize numbers
      const nLat = Number(selectedPosition.lat);
      const nLng = Number(selectedPosition.lng);

      // emit selected location only on confirm
      onSelectLocation(locationName, { lat: nLat, lng: nLng });
      onClose();
    }
  };

  // Prefill from incoming initialPosition prop
  useEffect(() => {
    if (initialPosition && initialPosition.lat != null && initialPosition.lng != null) {
      const nLat = Number(initialPosition.lat);
      const nLng = Number(initialPosition.lng);
      setSelectedPosition({ lat: nLat, lng: nLng });
      (async () => {
        const name = await reverseGeocode(nLat, nLng);
        setLocationName(name);
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPosition]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-4 rounded-lg w-4/5 h-4/5">
        <h2 className="sm:text-xl text-base  text-neutral-700 font-bold mb-4 text-center text">
          Select Location
        </h2>
        <MapContainer
          center={[13.03395, 77.56532]}
          zoom={20}
          style={{ height: "70%" }}
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <MapEvents />
        </MapContainer>
        <div className="mt-4 flex justify-between">
          <button
            onClick={onClose}
            className="btn bg-red-500 text-white px-4 py-2 rounded"
            disabled={loading}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="btn bg-green-500 text-white px-4 py-2 rounded"
            disabled={loading || !selectedPosition}
          >
            {loading ? "Loading..." : "Confirm Location"}
          </button>
        </div>
        {selectedPosition && (
          <div className="my-2 text-neutral-800 sm:text-base text-sm">
            <div>
              <b>Selected: </b> {locationName}
            </div>
            <div>
              <small>
                Lat: {Number(selectedPosition.lat).toFixed(6)}, Lng: {Number(selectedPosition.lng).toFixed(6)}
              </small>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MapModal;
