import { Context, RouteResponse, findAllRoutes, loadRoutes } from "./routes.ts";
import { JSONResponse } from "./api.ts";

interface OctopussOptions {
	routesDir: string;
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

	const routes = await loadRoutes(handlers);

	const middlewareHandler: Deno.ServeHandler = async (request, info) => {

		const { pathname } = new URL(request.url);

		const route = routes[pathname];
		if (!route) {
			return new Response(null, {
				status: 404
			});
		}

		let handlerResponse: RouteResponse
	
		try {
			handlerResponse = await route.handler(request, {} as Context);
		} catch (error) {
			console.error('Octo middleware error:', (error as Error).message || error);
			handlerResponse = new JSONResponse({
				error_text: 'unhandled middleware error'
			}, { status: 500 });
		}

		return handlerResponse instanceof JSONResponse ? new Response(handlerResponse.body, {
			headers: handlerResponse.headers,
			status: handlerResponse.status
		}) : handlerResponse;
	};

	Deno.serve(opts?.serve || {}, middlewareHandler);
};
