import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Layout, RoleRoute } from './components/Layout';
import { Spinner } from './components/ui';
import Home from './pages/Home';
import Login from './pages/Login';
import Onboarding from './pages/Onboarding';
import Policies from './pages/Policies';
import Suspension from './pages/Suspension';

// Las pantallas pesadas (mapas, calendario, gráficas) se cargan bajo demanda
const Search = lazy(() => import('./pages/Search'));
const TutorProfile = lazy(() => import('./pages/TutorProfile'));
const CalendarPage = lazy(() => import('./pages/CalendarPage'));
const Bookings = lazy(() => import('./pages/Bookings'));
const Offers = lazy(() => import('./pages/Offers'));
const Availability = lazy(() => import('./pages/Availability'));
const Chat = lazy(() => import('./pages/Chat'));
const Dashboard = lazy(() => import('./pages/admin/Dashboard'));
const Categories = lazy(() => import('./pages/admin/Categories'));
const Tutors = lazy(() => import('./pages/admin/Tutors'));
const Moderation = lazy(() => import('./pages/admin/Moderation'));
const Users = lazy(() => import('./pages/admin/Users'));

export default function App() {
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="onboarding" element={<Onboarding />} />
          <Route path="perfil" element={<Onboarding editing />} />
          <Route path="suspension" element={<Suspension />} />
          <Route path="politicas" element={<Policies />} />

          <Route element={<RoleRoute roles={['student']} />}>
            <Route path="buscar" element={<Search />} />
          </Route>
          <Route element={<RoleRoute roles={['student', 'tutor']} />}>
            <Route path="tutor/:id" element={<TutorProfile />} />
            <Route path="calendario" element={<CalendarPage />} />
            <Route path="mis-tutorias" element={<Bookings />} />
            <Route path="chat" element={<Chat />} />
          </Route>
          <Route element={<RoleRoute roles={['tutor']} />}>
            <Route path="mis-ofertas" element={<Offers />} />
            <Route path="disponibilidad" element={<Availability />} />
          </Route>
          <Route element={<RoleRoute roles={['admin']} />}>
            <Route path="admin" element={<Dashboard />} />
            <Route path="admin/categorias" element={<Categories />} />
            <Route path="admin/tutores" element={<Tutors />} />
            <Route path="admin/moderacion" element={<Moderation />} />
            <Route path="admin/usuarios" element={<Users />} />
          </Route>
          <Route path="*" element={<Home />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
