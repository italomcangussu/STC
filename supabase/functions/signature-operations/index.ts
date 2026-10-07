// @ts-nocheck — função Deno (imports `npm:`); a lógica testável está em _shared/signatureRequest.ts.
//
// Código de 6 dígitos da assinatura (pedir/confirmar) e despacho imediato dos avisos (admin).
// Exige o JWT do usuário (padrão do Supabase). Ver docs/assinaturas/OPERACAO_E_MIGRATIONS.md.
import { serveAdminEndpoint } from '../_shared/serveAdmin.ts';
import { createGeoResolver } from '../_shared/signatureGeo.ts';
import { DEFAULT_APP_URL } from '../_shared/signatureMessages.ts';
import { handleSignatureRequest, secureCode } from '../_shared/signatureRequest.ts';
import { uazCaller } from '../_shared/uazChat.ts';

const serverUrl = Deno.env.get('UAZAPI_SERVER_URL');
const instanceToken = Deno.env.get('STC_UAZAPI_INSTANCE_TOKEN');
const uaz = serverUrl && instanceToken ? uazCaller({ serverUrl, instanceToken }) : null;
const geo = createGeoResolver({ urlTemplate: Deno.env.get('STC_GEOIP_URL') });
const appUrl = Deno.env.get('STC_APP_URL') || DEFAULT_APP_URL;

// Sessão e papel são conferidos por `handleSignatureRequest` (o papel vem do banco, nunca do corpo).
serveAdminEndpoint((request, deps, envAdmin) => handleSignatureRequest(request, deps, {
  ...envAdmin, uaz, appUrl, geo, randomCode: secureCode,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}));
