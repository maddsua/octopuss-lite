import type { JSONResponse } from "./api.ts";
import type { RateLimiterConfig } from "./rateLimiter.ts";
import type { OriginManagerOptions } from "./originManager.ts";

export interface RouteConfig {
	expand?: boolean;
	url?: string;
	recaptcha?: {
		enabled: boolean;
		minScore?: number;
	};
	rateLimiter?: {
		enabled: boolean;
	} & Partial<RateLimiterConfig>;
	origin?: OriginManagerOptions;
};

export interface Context {
	env: Record<string, string>;
	requestIP: string;
	requestID: string | null;
};

export type RouteResponse = JSONResponse<object> | Response;
export type RouteHandler = (request: Request, context: Context) => Promise<RouteResponse> | RouteResponse;

export interface RouteCtx {
	expand: boolean;
	url: string;
	handler: RouteHandler;
};

interface RouteSearchResult {
	routesDir: string;
	entries: string[];
};

export const findAllRoutes = async (routesDir: string): Promise<RouteSearchResult> => {

	const entries: string[] = [];

	const iterate = async (dir: string) => {
		const nextEntries = Deno.readDir(dir);
		for await (const item of nextEntries) {
			const itemPath = `${dir}/${item.name}`;
			if (item.isDirectory) {
				await iterate(itemPath);
			} else if (item.isFile) {
				entries.push(itemPath);
			}
		}
	};
	await iterate(routesDir);

	return {
		routesDir,
		entries: entries.filter(item => ['js', 'mjs', 'ts', 'mts'].some(ext => item.endsWith(`.${ext}`)))
	};
};

export const loadRoutes = async (from: RouteSearchResult): Promise<Record<string, RouteCtx>> => {

	const result: Record<string, RouteCtx> = {};

	await Promise.all(from.entries.map(async item => {
		try {

			const importPath = `file:///${Deno.cwd()}/${item}`;

			console.log(importPath);

			const imported = await import(importPath);
	
			const handler = (imported['default'] || imported['handler']);
			if (!handler || typeof handler !== 'function') throw new Error('No handler exported');
	
			const config = (imported['config'] || {}) as RouteConfig;
			if (typeof config !== 'object') throw new Error('Config invalid');

			const pathNoExt = item.slice(from.routesDir.length, item.lastIndexOf('.'));
			const indexIndex = pathNoExt.lastIndexOf('/index');
			const fsRoutedUrl = indexIndex === -1 ? pathNoExt : (indexIndex === 0 ? '/' : pathNoExt.slice(0, indexIndex));
			const customUrl = config.url?.replace(/[\/\*]+$/, '');

			const url = typeof customUrl === 'string' ? customUrl : fsRoutedUrl;
			if (!url.startsWith('/')) throw new Error(`Invalid route url: ${url}`);

			result[url] = {
				handler,
				url,
				expand: typeof config.expand === 'boolean' ? config.expand : (config.url?.endsWith('*') || false)
				//	big todo: add warning for a case when both bool val and url with asterist are set
			} satisfies RouteCtx;

		} catch (error) {
			throw new Error(`Failed to import route module ${item}: ${(error as Error).message}`);
		}
	}));

	return result;
};
