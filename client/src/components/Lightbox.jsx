import React, { useState } from "react";

export default function Lightbox({ src, alt, children }) {
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(1);

  function close() { setOpen(false); setZoom(1); }

  return (
    <>
      <div onClick={() => setOpen(true)} style={{ cursor: "zoom-in" }}>
        {children}
      </div>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(17,20,30,0.92)" }}
          onClick={close}
        >
          <div className="absolute top-4 right-4 flex gap-2 z-10" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setZoom((z) => Math.min(z + 0.25, 4))} className="w-9 h-9 rounded-full text-lg font-bold" style={{ background: "#FFFFFF", color: "#1F2937" }}>+</button>
            <button onClick={() => setZoom((z) => Math.max(z - 0.25, 0.5))} className="w-9 h-9 rounded-full text-lg font-bold" style={{ background: "#FFFFFF", color: "#1F2937" }}>−</button>
            <button onClick={close} className="w-9 h-9 rounded-full text-lg font-bold" style={{ background: "#ED3237", color: "#FFFFFF" }}>✕</button>
          </div>
          <img
            src={src}
            alt={alt}
            onClick={(e) => e.stopPropagation()}
            style={{ transform: `scale(${zoom})`, transition: "transform 0.15s", maxWidth: "90vw", maxHeight: "85vh", objectFit: "contain", cursor: "default" }}
          />
        </div>
      )}
    </>
  );
}
