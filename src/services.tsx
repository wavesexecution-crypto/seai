import { createRoot } from "react-dom/client";
import ServicesPage from "./pages/ServicesPage";
import "./css/base.css";
import "./css/responsive.css";
import "./css/growth.css";

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<ServicesPage />);
}
