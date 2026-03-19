/**
 * NotFoundComponent (404 Page)
 *
 * Displays a 404 page for invalid routes.
 */

import { RouteMeta } from '@analogjs/router';
import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

export const routeMeta: RouteMeta = {
    title: 'Page Not Found | Arc CMS',
};

@Component({
    selector: 'arc-not-found',
    standalone: true,
    imports: [RouterLink],
    template: `
    <div class="not-found-container">
      <div class="not-found-content">
        <h1 class="error-code">404</h1>
        <p class="error-message"><span class="text-danger">Oops!</span> Page Not Found.</p>
        <p class="error-description">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <a routerLink="/" class="btn-home">Go to Home</a>
      </div>
    </div>
  `,
    styles: [`
    .not-found-container {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
    }
    
    .not-found-content {
      text-align: center;
      padding: 40px;
      background: white;
      border-radius: 16px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.1);
      max-width: 400px;
    }
    
    .error-code {
      font-size: 120px;
      font-weight: 700;
      color: #1a1a2e;
      margin: 0;
      line-height: 1;
    }
    
    .error-message {
      font-size: 24px;
      margin: 10px 0;
      color: #333;
    }
    
    .text-danger {
      color: #dc3545;
    }
    
    .error-description {
      color: #666;
      margin-bottom: 30px;
    }
    
    .btn-home {
      display: inline-block;
      padding: 12px 30px;
      background: linear-gradient(135deg, #3c76f5, #1d47a3);
      color: white;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 600;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    
    .btn-home:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(29, 71, 163, 0.4);
    }
  `]
})
export default class NotFoundComponent { }
