/**
 * Feature-module contract. A feature lives in src/features/<name>/ and exports (default) defineFeature({...}) from feature.ts.
 * scripts/gen-features.mjs discovers it automatically - no shared file needs editing. See DEVELOPING.md.
 */
import type { ReactNode } from 'react';
import type { AppContext } from '../server/context.ts';
import type { Cap } from '../lib/users.ts';
import type { Dict } from '../lib/i18n.ts';

export type { AppContext, Cap };

export type PageProps = {
  ctx: AppContext;
  /** `:name` segments of the page path */
  params: Record<string, string>;
  searchParams: Record<string, string | string[] | undefined>;
};

export type FeaturePage = {
  /** Exact path (`/hotspot/hosts`) or with `:param` segments (`/hotspot/users/:id`). */
  path: string;
  /** Capability required (default 'view'). Checked BEFORE the component loads. */
  cap?: Cap;
  /** Page title (English source string, translated with t()). */
  title: string;
  /** Value of <body data-page> (the shared pages.js activates per-page behaviour from it). Default: the nav key or the feature id. */
  page?: string;
  /** Extra shared scripts to load after app.js: 'charts' | 'qr' | 'pages' | 'next-live' or an absolute /assets/js/x.js URL. */
  scripts?: string[];
  /** Lazy import of the server component that renders the page body (inside the shell). Runs inside ctx.run(). */
  component: () => Promise<{ default: (props: PageProps) => ReactNode | Promise<ReactNode> }>;
};

export type ApiHandler = (ctx: AppContext, req: Request, rest: string[]) => Promise<Response | Record<string, unknown>> | Response | Record<string, unknown>;
export type ApiRoute = {
  /** Capability for every method of this route unless `caps` overrides it (default 'view'). */
  cap?: Cap;
  caps?: Partial<Record<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', Cap>>;
  GET?: ApiHandler;
  POST?: ApiHandler;
  PUT?: ApiHandler;
  PATCH?: ApiHandler;
  DELETE?: ApiHandler;
};

export type NavItem = {
  /** unique key; also the default <body data-page> */
  key: string;
  href: string;
  icon: string;
  /** English label (translated). */
  label: string;
  /** Sidebar group: Overview | Hotspot | Sales | Network | System | Platform | any new name (appended). */
  group: string;
  cap?: Cap;
  /** Sort position inside the group (default 100). */
  order?: number;
  /** Show in the mobile bottom tab bar (lower number = further left, max 4 shown). */
  tab?: number;
};

export type Feature = {
  id: string;
  nav?: NavItem[];
  pages?: FeaturePage[];
  /** Mounted at /api/json/<name>[/...] (and /json/<name> for the shared JS). */
  api?: Record<string, ApiRoute>;
  /** Extra translations, merged into the core dictionaries. English is the source language. */
  i18n?: { id?: Dict; en?: Dict };
};

export const defineFeature = (f: Feature): Feature => f;
