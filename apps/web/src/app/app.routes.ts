import { Routes } from '@angular/router';
import { authGuard, guestGuard, platformAdminGuard, visitorMatch } from './core/guards';

export const routes: Routes = [
  {
    // Home for visitors: the product page. Signed-in users go straight to the app (next route).
    path: '',
    pathMatch: 'full',
    canMatch: [visitorMatch],
    title: 'Electrical installation planning',
    loadComponent: () => import('./features/landing/landing.page').then((m) => m.LandingPage),
  },
  {
    // The product page, also reachable when signed in.
    path: 'welcome',
    title: 'Electrical installation planning',
    loadComponent: () => import('./features/landing/landing.page').then((m) => m.LandingPage),
  },
  {
    path: 'sign-in',
    canActivate: [guestGuard],
    title: 'Sign in',
    loadComponent: () => import('./features/auth/sign-in.page').then((m) => m.SignInPage),
  },
  {
    path: 'sign-up',
    canActivate: [guestGuard],
    title: 'Create account',
    loadComponent: () => import('./features/auth/sign-up.page').then((m) => m.SignUpPage),
  },
  {
    // Invitation link: works signed in or signed out, so no guard.
    path: 'invite/:token',
    title: 'Invitation',
    loadComponent: () => import('./features/auth/invitation.page').then((m) => m.InvitationPage),
  },
  {
    // Full-screen editor, outside the app shell.
    path: 'projects/:projectId/floors/:floorId',
    canActivate: [authGuard],
    title: 'Editor',
    loadComponent: () => import('./features/editor/editor.page').then((m) => m.EditorPage),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./features/shell/shell').then((m) => m.Shell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'clients' },
      {
        path: 'clients',
        title: 'Clients',
        loadComponent: () => import('./features/clients/clients.page').then((m) => m.ClientsPage),
      },
      {
        path: 'clients/:clientId',
        title: 'Client',
        loadComponent: () => import('./features/clients/client-detail.page').then((m) => m.ClientDetailPage),
      },
      {
        path: 'projects',
        title: 'Projects',
        loadComponent: () => import('./features/projects/projects.page').then((m) => m.ProjectsPage),
      },
      {
        path: 'projects/:projectId',
        title: 'Project',
        loadComponent: () => import('./features/projects/project-detail.page').then((m) => m.ProjectDetailPage),
      },
      {
        path: 'projects/:projectId/installation',
        title: 'Circuits & calculations',
        loadComponent: () => import('./features/installation/installation.page').then((m) => m.InstallationPage),
      },
      {
        path: 'settings',
        title: 'Settings',
        loadComponent: () => import('./features/settings/settings.page').then((m) => m.SettingsPage),
      },
      {
        // Product owner panel (accounts in the API's PLATFORM_ADMIN_EMAILS). The API refuses everyone else too.
        path: 'admin',
        canActivate: [platformAdminGuard],
        title: 'Admin panel',
        loadComponent: () => import('./features/admin/admin.page').then((m) => m.AdminPage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
