import { Context, JSONResponse, type RouteConfig, type RouteCtx } from "./server/api.ts";

const searchDir = 'src/routes';

const findAllHandlers = async (handlersDir: string) => {
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
	await iterate(handlersDir);
	return entries.filter(item => ['js', 'mjs', 'ts', 'mts'].some(ext => item.endsWith(`.${ext}`)));
};

const loadHandlers = async (modulePaths: string[]): Promise<RouteCtx[]> => {
	return await Promise.all(modulePaths.map(async item => {
		try {

			const importPath = `./${item}`;

			const imported = await import(importPath);
	
			const handler = (imported['default'] || imported['handler']);
			if (!handler || typeof handler !== 'function') throw new Error('No handler exported');
	
			const config = (imported['config'] || {}) as RouteConfig;
			if (typeof config !== 'object') throw new Error('Config invalid');

			const pathNoExt = item.slice(searchDir.length, item.lastIndexOf('.'));
			const indexIndex = pathNoExt.lastIndexOf('/index');
			const fsRoutedUrl = indexIndex === -1 ? pathNoExt : (indexIndex === 0 ? '/' : pathNoExt.slice(0, indexIndex));
			const customUrl = config.url?.replace(/[\/\*]+$/, '');

			const url = typeof customUrl === 'string' ? customUrl : fsRoutedUrl;
			if (!url.startsWith('/')) throw new Error(`Invalid route url: ${url}`);
	
			return {
				handler,
				url,
				expand: typeof config.expand === 'boolean' ? config.expand : (config.url?.endsWith('*') || false)
			} satisfies RouteCtx;

		} catch (error) {
			throw new Error(`Failed to import route module ${item}: ${(error as Error).message}`);
		}
	}));
};

const handlers = await loadHandlers(await findAllHandlers(searchDir))

console.log(handlers);

Deno.serve(async (request) => {

	const { pathname } = new URL(request.url);

	const handler = handlers.find(item => item.url === pathname);
	if (!handler) {
		return new Response(null, {
			status: 404
		});
	}

	const handlerResponse = await handler.handler(request, {} as Context);
	
	return handlerResponse instanceof JSONResponse ? new Response(handlerResponse.body, {
		headers: handlerResponse.headers,
		status: handlerResponse.status
	}) : handlerResponse;
});
