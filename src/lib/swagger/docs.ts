import { hashMatches } from "../reader/auth.ts";
import { openApiDocument } from "./openapi.ts";

const headers = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

function credential(request: Request): string | null {
  const bearer = /^Bearer (.+)$/i.exec(request.headers.get("authorization") || "")?.[1];
  const hash = bearer ?? new URL(request.url).searchParams.get("hash");
  return hashMatches(hash) ? hash! : null;
}

function unauthorized() {
  return Response.json({ error: "Unauthorized" }, { status: 401, headers });
}

export function handleOpenApi(request: Request): Response {
  if (!credential(request)) return unauthorized();
  return Response.json(openApiDocument, { headers });
}

export function handleSwaggerAsset(
  request: Request,
  assets: { css: string; js: string },
): Response {
  if (!credential(request)) return unauthorized();
  const file = new URL(request.url).searchParams.get("file");
  if (file !== "css" && file !== "js")
    return Response.json({ error: "Asset not found." }, { status: 404, headers });
  return new Response(assets[file], {
    headers: {
      ...headers,
      "content-type":
        file === "css" ? "text/css; charset=utf-8" : "application/javascript; charset=utf-8",
    },
  });
}

export function handleSwaggerDocs(
  request: Request,
  favicons?: { small: string; large: string },
): Response {
  const hash = credential(request);
  if (!hash) return unauthorized();
  const key = JSON.stringify(hash).replace(
    /[<>&\u2028\u2029]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  const icons = favicons
    ? `<link rel="icon" type="image/png" sizes="16x16" href="${favicons.small}"><link rel="icon" type="image/png" sizes="32x32" href="${favicons.large}">`
    : '<link rel="icon" href="data:,">';
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer">${icons}<title>Folio API — Swagger</title>
<style>body{margin:0;background:#faf9f6;color:#24211c;font-family:system-ui,sans-serif}.notice{padding:16px 24px;border-bottom:1px solid #ddd5c8;font-size:14px}.notice a{color:#963512}#loading{padding:24px}#swagger-ui{padding-bottom:32px}</style></head>
<body><div class="notice"><strong>Folio API</strong> · Hash-protected documentation. “Try it out” can save files or start jobs. <a href="/">Back to reader</a></div><div id="loading" role="status">Loading Swagger UI…</div><div id="swagger-ui"></div>
<script>
(async function(){
  const key=${key};
  const get=async function(path){const res=await fetch(path,{headers:{Authorization:'Bearer '+key},cache:'no-store'});if(!res.ok)throw new Error('Unable to load protected API documentation.');return res;};
  try{
    const responses=await Promise.all([get('/api/docs/assets?file=css'),get('/api/docs/assets?file=js'),get('/api/openapi')]);
    const css=await responses[0].text(),js=await responses[1].text(),spec=await responses[2].json();
    const style=document.createElement('style');style.textContent=css;document.head.appendChild(style);
    const blob=URL.createObjectURL(new Blob([js],{type:'application/javascript'}));
    await new Promise(function(resolve,reject){const script=document.createElement('script');script.src=blob;script.onload=resolve;script.onerror=reject;document.head.appendChild(script);});URL.revokeObjectURL(blob);
    const ui=SwaggerUIBundle({spec:spec,dom_id:'#swagger-ui',deepLinking:true,persistAuthorization:false,validatorUrl:null,defaultModelsExpandDepth:-1,
      requestInterceptor:function(req){const url=new URL(req.url,location.origin);if(url.origin!==location.origin||!url.pathname.startsWith('/api/'))throw new Error('Only this server’s API can be called.');return req;}});
    ui.preauthorizeApiKey('AccessHash',key);document.getElementById('loading').remove();
  }catch(error){document.getElementById('loading').textContent='Unable to load Swagger UI. Reopen /api/docs with your access hash.';}
})();
</script></body></html>`;
  return new Response(html, {
    headers: { ...headers, "content-type": "text/html; charset=utf-8" },
  });
}
