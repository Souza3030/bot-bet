import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import path from "path";
import { config } from "../config";

/**
 * Inicializa o Firebase Admin SDK usando o arquivo de credenciais da
 * service account apontado em FIREBASE_SERVICE_ACCOUNT_PATH.
 *
 * Este módulo deve ser importado apenas uma vez (efeito colateral de
 * inicialização). Os demais módulos devem importar `db` a partir daqui.
 */
type ServiceAccountFile = {
  project_id?: string;
  client_email?: string;
  private_key?: string;
};

if (admin.apps.length === 0) {
  const serviceAccountPath = path.resolve(
    process.cwd(),
    config.firebase.serviceAccountPath
  );

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const serviceAccount = require(serviceAccountPath) as ServiceAccountFile;

  if (!serviceAccount.project_id) {
    throw new Error("O arquivo da service account não possui o campo obrigatório project_id.");
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: serviceAccount.project_id,
      clientEmail: serviceAccount.client_email,
      privateKey: serviceAccount.private_key,
    }),
    projectId: serviceAccount.project_id,
  });

  console.log("[Firebase] Firebase Admin inicializado com sucesso.");
}

export const db = getFirestore(admin.app(), "(default)");
export const FieldValue = admin.firestore.FieldValue;
export default admin;
