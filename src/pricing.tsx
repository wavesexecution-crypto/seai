import { createRoot } from "react-dom/client";
import PricingPage from "./pages/PricingPage";
import "./css/base.css";
import "./css/responsive.css";
import "./css/growth.css";

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<PricingPage />);
}
