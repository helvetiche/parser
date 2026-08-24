import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase";
import { roleFromUnknown } from "./role-schema";
import type { RoleData, RoleRow } from "./role-schema";

export type { RoleData, RoleRow };

const ROLES_COLLECTION = "roles";

export function subscribeToRoles(
  onNext: (rows: RoleRow[]) => void,
  onError: (error: Error) => void
) {
  const q = query(collection(db, ROLES_COLLECTION), orderBy("createdAt", "desc"));
  return onSnapshot(
    q,
    (snapshot) =>
      onNext(
        snapshot.docs.map((d) => ({
          ...roleFromUnknown(d.data()),
          id: d.id,
        }))
      ),
    onError
  );
}

export async function saveRole(role: RoleData): Promise<string> {
  const ref = await addDoc(collection(db, ROLES_COLLECTION), {
    ...role,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function deleteRole(id: string): Promise<void> {
  await deleteDoc(doc(db, ROLES_COLLECTION, id));
}
