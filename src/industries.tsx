import { createRoot } from "react-dom/client";
import IndustriesPage from "./pages/IndustriesPage";
import "./css/base.css";
import "./css/responsive.css";
import "./css/growth.css";

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<IndustriesPage />);
}
