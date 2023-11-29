import { findAllRoutes, loadRoutes, type Context } from "./routes.ts";
import { JSONResponse } from "./api.ts";

interface OctopussOptions {
	routesDir: string;
	proxy?: {
		forwardedHeader?: string;
	}
//	defaultError?: 'json' | 'text';
};

interface StartServerOptions {
	serve?: Deno.ServeOptions | Deno.ServeTlsOptions;
	octo?: OctopussOptions;
};

export const startServer = async (opts?: StartServerOptions) => {

	let searchDir = opts?.octo?.routesDir || 'src/routes';

	const handlers = await findAllRoutes(searchDir);
	if (!handlers.entries.length) throw new Error(`Failed to load route modules: no modules found in "${searchDir}"`);

	const routesPool = await loadRoutes(handlers);

	const middlewareHandler: Deno.ServeHandler = async (request, info) => {

		const { pathname } = new URL(request.url);
		const pathComponents = pathname.slice(1).split('/');

		const route = routesPool[pathname];
		if (!route) {
			return new JSONResponse({
				error_text: 'route not found'
			}, { status: 404 }).toResponse();
		}

		try {
			const handlerResponse = await route.handler(request, {} as Context);
			return handlerResponse instanceof JSONResponse ? handlerResponse.toResponse() : handlerResponse;
		} catch (error) {
			console.error('Octo middleware error:', (error as Error).message || error);
			return new JSONResponse({
				error_text: 'unhandled middleware error'
			}, { status: 500 }).toResponse();
		}
	};

	const httpRequestHandler: Deno.ServeHandler = async (request, info) => {
		const middleware = await middlewareHandler(request, info);
		middleware.headers.set('x-powered-by', 'octopuss');
		return middleware;
	};

	if (!opts?.serve) {
		Deno.serve(httpRequestHandler);
		return
	}

	Deno.serve(opts?.serve, middlewareHandler);
};
