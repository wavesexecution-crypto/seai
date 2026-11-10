import { createRoot } from "react-dom/client";
import ContactPage from "./pages/ContactPage";
import "./css/base.css";
import "./css/responsive.css";
import "./css/growth.css";

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<ContactPage />);
}
