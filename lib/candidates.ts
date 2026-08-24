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
import { candidateFromUnknown } from "./candidate-schema";
import type { Candidate, CandidateRow, ContactItem, ContactType } from "./candidate-schema";

export type { Candidate, CandidateRow, ContactItem, ContactType };

const CANDIDATES_COLLECTION = "candidates";

export function subscribeToCandidates(
  onNext: (rows: CandidateRow[]) => void,
  onError: (error: Error) => void
) {
  const q = query(collection(db, CANDIDATES_COLLECTION), orderBy("createdAt", "desc"));
  return onSnapshot(
    q,
    (snapshot) =>
      onNext(
        snapshot.docs.map((d) => ({
          ...candidateFromUnknown(d.data()),
          id: d.id,
        }))
      ),
    onError
  );
}

export async function saveCandidate(candidate: Candidate): Promise<string> {
  const ref = await addDoc(collection(db, CANDIDATES_COLLECTION), {
    ...candidate,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function deleteCandidate(id: string): Promise<void> {
  await deleteDoc(doc(db, CANDIDATES_COLLECTION, id));
}
