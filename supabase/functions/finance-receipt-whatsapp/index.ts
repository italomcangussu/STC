// @ts-nocheck
// Processamento só acontece depois de finalidade esclarecida e autorização explícita.
// Nunca registrar imagem recebida por WhatsApp como mensalidade de forma automática.
import {handleConfirmedReceipt} from './confirmedReceipt.ts';
Deno.serve(handleConfirmedReceipt);
