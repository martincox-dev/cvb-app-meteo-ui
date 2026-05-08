export default function WindArrow({ direction, size = 48, color = "white", className = "" }) {
  // direction: degrees, 0=N, 90=E, 180=S, 270=W
  // Arrow points in the direction the wind is coming FROM (nautical convention)
  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        transform: `rotate(${direction}deg)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "transform 0.8s ease",
      }}
    >
      <svg
        viewBox="0 0 40 40"
        width={size}
        height={size}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Circle */}
        <circle cx="20" cy="20" r="18" stroke={color} strokeWidth="1.5" strokeOpacity="0.3" />
        {/* Arrow shaft */}
        <line x1="20" y1="30" x2="20" y2="12" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
        {/* Arrowhead */}
        <path d="M13 18 L20 8 L27 18" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" fill="none" />
      </svg>
    </div>
  );
}