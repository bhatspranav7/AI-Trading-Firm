import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Shell } from "./app/Shell";
import { Landing } from "./pages/Landing";
import { Command } from "./pages/Command";
import { BoardroomPage } from "./pages/Boardroom";
import { Desks } from "./pages/Desks";
import { Book } from "./pages/Book";
import { People } from "./pages/People";
import { JournalPage } from "./pages/Journal";
import { SettingsPage } from "./pages/Settings";
import { FirmProvider } from "./store";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <FirmProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/app" element={<Shell />}>
            <Route index element={<Command />} />
            <Route path="boardroom" element={<BoardroomPage />} />
            <Route path="boardroom/:id" element={<BoardroomPage />} />
            <Route path="desks" element={<Desks />} />
            <Route path="desks/:symbol" element={<Desks />} />
            <Route path="book" element={<Book />} />
            <Route path="people" element={<People />} />
            <Route path="journal" element={<JournalPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </FirmProvider>
  </React.StrictMode>,
);
