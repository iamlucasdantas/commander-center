import { ImageResponse } from "next/og";

// Magnetic Funnels apple touch icon: heatbar de 4 células no gradiente chama
// (#F0772E -> #EB611C -> #C0240A) sobre o fundo oficial #0D0D0D.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

const BARS = [
  { h: 39, c: "#F0772E" },
  { h: 62, c: "#E05B22" },
  { h: 84, c: "#D04016" },
  { h: 107, c: "#C0240A" },
];

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
          gap: 8,
          paddingBottom: 47,
          background: "#0D0D0D",
        }}
      >
        {BARS.map((b, i) => (
          <div key={i} style={{ width: 22, height: b.h, background: b.c, borderRadius: 4 }} />
        ))}
      </div>
    ),
    { ...size }
  );
}
