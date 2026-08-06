import { ImageResponse } from "next/og";

/**
 * Иконка приложения для iOS. Генерируется на сборке, а не лежит файлом:
 * внешних конвертеров SVG→PNG в окружении нет, а держать бинарник в репозитории
 * ради одной картинки — лишняя сущность, которая разъедется с брендом.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0b",
          color: "#fff",
          fontSize: 92,
          fontWeight: 700,
          letterSpacing: -4,
        }}
      >
        FW
        <span style={{ color: "#f97316" }}>.</span>
      </div>
    ),
    size,
  );
}
