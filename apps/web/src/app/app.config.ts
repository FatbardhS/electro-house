import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { TitleStrategy, provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { TranslatedTitleStrategy } from './core/i18n/title.strategy';
import { routes } from './app.routes';
import { sessionExpiredInterceptor } from './core/guards';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withFetch(), withInterceptors([sessionExpiredInterceptor])),
    provideRouter(routes, withComponentInputBinding(), withInMemoryScrolling({ scrollPositionRestoration: 'top' })),
    { provide: TitleStrategy, useClass: TranslatedTitleStrategy },
  ],
};
