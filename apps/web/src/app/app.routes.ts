import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/guards';

export const routes: Routes = [
  {
    path: 'sign-in',
    canActivate: [guestGuard],
    title: 'Sign in · Electro House',
    loadComponent: () => import('./features/auth/sign-in.page').then((m) => m.SignInPage),
  },
  {
    path: 'sign-up',
    canActivate: [guestGuard],
    title: 'Create account · Electro House',
    loadComponent: () => import('./features/auth/sign-up.page').then((m) => m.SignUpPage),
  },
  {
    // Invitation link: works signed in or signed out, so no guard.
    path: 'invite/:token',
    title: 'Invitation · Electro House',
    loadComponent: () => import('./features/auth/invitation.page').then((m) => m.InvitationPage),
  },
  {
    // Full-screen editor, outside the app shell.
    path: 'projects/:projectId/floors/:floorId',
    canActivate: [authGuard],
    title: 'Editor · Electro House',
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
        title: 'Clients · Electro House',
        loadComponent: () => import('./features/clients/clients.page').then((m) => m.ClientsPage),
      },
      {
        path: 'clients/:clientId',
        title: 'Client · Electro House',
        loadComponent: () => import('./features/clients/client-detail.page').then((m) => m.ClientDetailPage),
      },
      {
        path: 'projects',
        title: 'Projects · Electro House',
        loadComponent: () => import('./features/projects/projects.page').then((m) => m.ProjectsPage),
      },
      {
        path: 'projects/:projectId',
        title: 'Project · Electro House',
        loadComponent: () => import('./features/projects/project-detail.page').then((m) => m.ProjectDetailPage),
      },
      {
        path: 'projects/:projectId/installation',
        title: 'Circuits & calculations · Electro House',
        loadComponent: () => import('./features/installation/installation.page').then((m) => m.InstallationPage),
      },
      {
        path: 'settings',
        title: 'Settings · Electro House',
        loadComponent: () => import('./features/settings/settings.page').then((m) => m.SettingsPage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
