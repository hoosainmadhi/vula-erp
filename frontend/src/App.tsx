import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import PublicLayout from './components/PublicLayout';
import { Spinner } from './components/ui';
import { useAuth } from './auth';
import { ModulesProvider, useModules } from './modules';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const PartnersPage = lazy(() => import('./pages/PartnersPage'));
const ProductsPage = lazy(() => import('./pages/ProductsPage'));
const InventoryPage = lazy(() => import('./pages/InventoryPage'));
const PurchaseOrdersPage = lazy(() => import('./pages/PurchaseOrdersPage'));
const SalesOrdersPage = lazy(() => import('./pages/SalesOrdersPage'));
const InvoicesPage = lazy(() => import('./pages/InvoicesPage'));
const AccountingPage = lazy(() => import('./pages/AccountingPage'));
const ExpensesPage = lazy(() => import('./pages/ExpensesPage'));
const BankReconciliationPage = lazy(() => import('./pages/BankReconciliationPage'));
const ImportPage = lazy(() => import('./pages/ImportPage'));
const EmployeesPage = lazy(() => import('./pages/EmployeesPage'));
const TimeOffPage = lazy(() => import('./pages/TimeOffPage'));
const TimesheetsPage = lazy(() => import('./pages/TimesheetsPage'));
const AttendancePage = lazy(() => import('./pages/AttendancePage'));
const ProjectsPage = lazy(() => import('./pages/ProjectsPage'));
const BarcodePage = lazy(() => import('./pages/BarcodePage'));
const MaintenancePage = lazy(() => import('./pages/MaintenancePage'));
const RecruitmentPage = lazy(() => import('./pages/RecruitmentPage'));
const ManufacturingPage = lazy(() => import('./pages/ManufacturingPage'));
const PosPage = lazy(() => import('./pages/PosPage'));
const BlogsPage = lazy(() => import('./pages/BlogsPage'));
const WebsitePage = lazy(() => import('./pages/WebsitePage'));
const BlogListPage = lazy(() => import('./pages/BlogListPage'));
const BlogPostPage = lazy(() => import('./pages/BlogPostPage'));
const PublicSitePage = lazy(() => import('./pages/PublicSitePage'));
const MyLeavePage = lazy(() => import('./pages/MyLeavePage'));
const WorkshopPage = lazy(() => import('./pages/WorkshopPage'));
const QuotationsPage = lazy(() => import('./pages/QuotationsPage'));
const PrintQuotationPage = lazy(() => import('./pages/PrintQuotationPage'));
const UsersPage = lazy(() => import('./pages/UsersPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const PluginsPage = lazy(() => import('./pages/PluginsPage'));

function Page({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Spinner label="Loading…" />}>{children}</Suspense>;
}

function Guard({
  permission,
  module,
  fallback = '/',
  children,
}: {
  permission: string;
  module?: string;
  fallback?: string;
  children: ReactNode;
}) {
  const { can } = useAuth();
  const { isEnabled } = useModules();
  if (!can(permission)) return <Navigate to={fallback} replace />;
  if (module && !isEnabled(module)) return <Navigate to={fallback} replace />;
  return <>{children}</>;
}

function HomeRoute() {
  const { can } = useAuth();
  if (can('dashboard.view')) {
    return (
      <Page>
        <DashboardPage />
      </Page>
    );
  }
  return <Navigate to={can('workshop.view') ? '/workshop' : '/my-leave'} replace />;
}

function isPublicPath(pathname: string): boolean {
  return (
    pathname === '/site' ||
    pathname.startsWith('/site/') ||
    pathname === '/blog' ||
    pathname.startsWith('/blog/')
  );
}

export default function App() {
  const { user, booting } = useAuth();
  const location = useLocation();

  if (booting) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-100">
        <Spinner label="Signing you in…" />
      </div>
    );
  }

  if (isPublicPath(location.pathname)) {
    return (
      <Routes>
        <Route element={<PublicLayout />}>
          <Route
            path="/site"
            element={
              <Page>
                <PublicSitePage />
              </Page>
            }
          />
          <Route
            path="/site/:slug"
            element={
              <Page>
                <PublicSitePage />
              </Page>
            }
          />
          <Route
            path="/blog"
            element={
              <Page>
                <BlogListPage />
              </Page>
            }
          />
          <Route
            path="/blog/:slug"
            element={
              <Page>
                <BlogPostPage />
              </Page>
            }
          />
        </Route>
      </Routes>
    );
  }

  if (!user) {
    return location.pathname.startsWith('/login') ? (
      <Suspense fallback={<Spinner label="Loading…" />}>
        <LoginPage />
      </Suspense>
    ) : (
      <Navigate to="/login" replace />
    );
  }

  if (location.pathname.startsWith('/login')) return <Navigate to="/" replace />;

  if (location.pathname.startsWith('/print/')) {
    return (
      <Routes>
        <Route
          path="/print/quotation/:id"
          element={
            <Page>
              <PrintQuotationPage />
            </Page>
          }
        />
      </Routes>
    );
  }

  return (
    <ModulesProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomeRoute />} />
          <Route
            path="/my-leave"
            element={
              <Guard permission="leave.self" module="time-off">
                <Page>
                  <MyLeavePage />
                </Page>
              </Guard>
            }
          />
          <Route
            path="/partners"
            element={
              <Guard permission="partners.view" module="partners">
                <Page>
                  <PartnersPage />
                </Page>
              </Guard>
            }
          />
          <Route
            path="/products"
            element={
              <Guard permission="products.view" module="products">
                <Page>
                  <ProductsPage />
                </Page>
              </Guard>
            }
          />
          <Route
            path="/inventory"
            element={
              <Guard permission="products.view" module="inventory">
                <Page>
                  <InventoryPage />
                </Page>
              </Guard>
            }
          />
          <Route
            path="/purchases"
            element={
              <Guard permission="purchases.view" module="purchases">
                <Page>
                  <PurchaseOrdersPage />
                </Page>
              </Guard>
            }
          />
          <Route
            path="/sales"
            element={
              <Guard permission="sales.view" module="sales">
                <Page>
                  <SalesOrdersPage />
                </Page>
              </Guard>
            }
          />
          <Route
            path="/quotations"
            element={
              <Guard permission="sales.view" module="sales">
                <Page>
                  <QuotationsPage />
                </Page>
              </Guard>
            }
          />
          <Route
            path="/invoices"
            element={
              <Guard permission="invoices.view" module="invoicing">
                <Page>
                  <InvoicesPage />
                </Page>
              </Guard>
            }
          />
          <Route
            path="/accounting"
            element={
              <Guard permission="accounting.view" module="accounting">
                <Page>
                  <AccountingPage />
                </Page>
              </Guard>
            }
          />
          <Route
            path="/expenses"
            element={
              <Guard permission="expenses.view" module="expenses">
                <Page>
                  <ExpensesPage />
                </Page>
              </Guard>
            }
          />
          <Route
            path="/bank-reconciliation"
            element={
              <Guard permission="accounting.view" module="accounting">
                <Page>
                  <BankReconciliationPage />
                </Page>
              </Guard>
            }
          />
          <Route
            path="/employees"
            element={
              <Guard permission="hr.view" module="hr">
                <Page>
                  <EmployeesPage />
                </Page>
              </Guard>
            }
          />
          <Route
            path="/time-off"
            element={
              <Guard permission="hr.view" module="time-off">
                <Page>
                  <TimeOffPage />
                </Page>
              </Guard>
            }
          />
          <Route
            path="/timesheets"
            element={
              <Guard permission="hr.view" module="timesheets">
                <Page>
                  <TimesheetsPage />
                </Page>
              </Guard>
            }
          />
          <Route
            path="/attendance"
            element={
              <Guard permission="attendance.view" module="attendance">
                <Page>
                  <AttendancePage />
                </Page>
              </Guard>
            }
          />
          <Route
            path="/projects"
            element={
              <Guard permission="projects.view" module="projects">
                <Page>
                  <ProjectsPage />
                </Page>
              </Guard>
            }
          />
          <Route
            path="/barcode"
            element={
              <Guard permission="products.view" module="barcode">
                <Page>
                  <BarcodePage />
                </Page>
              </Guard>
            }
          />
          <Route
            path="/pos"
            element={
              <Guard permission="pos.view" module="pos">
                <Page>
                  <PosPage />
                </Page>
              </Guard>
            }
          />
          <Route
            path="/manufacturing"
            element={
              <Guard permission="manufacturing.view" module="manufacturing">
                <Page>
                  <ManufacturingPage />
                </Page>
              </Guard>
            }
          />
          <Route
            path="/maintenance"
            element={
              <Guard permission="maintenance.view" module="maintenance">
                <Page>
                  <MaintenancePage />
                </Page>
              </Guard>
            }
          />
          <Route
            path="/recruitment"
            element={
              <Guard permission="recruitment.view" module="recruitment">
                <Page>
                  <RecruitmentPage />
                </Page>
              </Guard>
            }
          />
          <Route
            path="/workshop"
            element={
              <Guard permission="workshop.view" module="workshop">
                <Page>
                  <WorkshopPage />
                </Page>
              </Guard>
            }
          />
          <Route
            path="/blogs"
            element={
              <Guard permission="blogs.view" module="blogs">
                <Page>
                  <BlogsPage />
                </Page>
              </Guard>
            }
          />
          <Route
            path="/website"
            element={
              <Guard permission="website.view" module="website">
                <Page>
                  <WebsitePage />
                </Page>
              </Guard>
            }
          />
          <Route
            path="/plugins"
            element={
              <Guard permission="modules.manage">
                <Page>
                  <PluginsPage />
                </Page>
              </Guard>
            }
          />
          <Route
            path="/imports"
            element={
              <Guard permission="data.import">
                <Page>
                  <ImportPage />
                </Page>
              </Guard>
            }
          />
          <Route
            path="/users"
            element={
              <Guard permission="users.manage">
                <Page>
                  <UsersPage />
                </Page>
              </Guard>
            }
          />
          <Route
            path="/settings"
            element={
              <Guard permission="settings.manage">
                <Page>
                  <SettingsPage />
                </Page>
              </Guard>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ModulesProvider>
  );
}
