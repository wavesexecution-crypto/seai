import { createRoot } from "react-dom/client";
import ExamplesPage from "./pages/ExamplesPage";
import "./css/base.css";
import "./css/home.css";
import "./css/responsive.css";
import "./css/growth.css";

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<ExamplesPage />);
}
