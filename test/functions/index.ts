import Component from './index.tsx';

import { RouteConfig } from "../../server/routeHandlers.ts";

export const config: RouteConfig = {
	expand: true
};

export const handler = () => {
	const htmlcontent = Component().render();
	return new Response(htmlcontent, {
		headers: {
			'content-type': 'text/html'
		}
	});
};
