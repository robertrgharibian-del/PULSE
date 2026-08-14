import React, { useState } from "react";
import { api } from "../api.js";

const COLORS = ["#3E4095", "#ED3237", "#16A34A", "#7C3AED", "#C58A1F"];

function colorFor(name) {
  let hash = 0;
  for (let i = 0; i < (name || "").length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return COLORS[Math.abs(hash) % COLORS.length];
}
function initials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || name[0].toUpperCase();
}

export default function Avatar({ userId, name, size = 32 }) {
  const [errored, setErrored] = useState(false);
  const px = `${size}px`;

  if (!userId || errored) {
    return (
      <div className="rounded-full flex items-center justify-center shrink-0 font-semibold"
        style={{ width: px, height: px, background: colorFor(name), color: "#FFFFFF", fontSize: size * 0.38 }}>
        {initials(name)}
      </div>
    );
  }
  return (
    <img
      src={api.userPhotoUrl(userId)}
      alt={name || "avatar"}
      onError={() => setErrored(true)}
      className="rounded-full object-cover shrink-0"
      style={{ width: px, height: px, background: "#E4E7F0" }}
    />
  );
}
