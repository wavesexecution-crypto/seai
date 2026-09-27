import { createRoot } from "react-dom/client";
import Homepage from "./components/homepage/Homepage";
import "./css/base.css";
import "./css/home.css";
import "./css/fan-carousel.css";
import "./css/responsive.css";
import "./css/pages.css";
// NOTE: demo.css styles the standalone /examples/*.html demo pages (loaded via
// src/demo.js). The homepage does not need it; intake.html loads the vanilla
// src/main.js bundle which keeps the intake flow untouched.

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<Homepage />);
}