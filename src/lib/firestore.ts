import { Firestore } from "@google-cloud/firestore";

let firestore: Firestore | null = null;

function resolveProjectId(): string | undefined {
  return (
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.FIREBASE_PROJECT_ID
  );
}

export function getFirestore(): Firestore {
  if (firestore) {
    return firestore;
  }

  const projectId = resolveProjectId();
  firestore = projectId ? new Firestore({ projectId }) : new Firestore();
  firestore.settings({ ignoreUndefinedProperties: true });
  return firestore;
}
