import { db } from "../firebase/admin";
import type {
  DocumentSnapshot,
  Query,
  QueryDocumentSnapshot,
  QuerySnapshot,
  Transaction,
} from "firebase-admin/firestore";
import { config } from "../config";
import { BetEntry, BetStatus, PixKeyType, WaitingBet } from "../types";

const BETS_COLLECTION = "soloBets";
const QUEUE_COLLECTION = "soloBetQueue";

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isNotFound(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  return code === 5 || code === "5" || code === "NOT_FOUND";
}

async function readDocumentOrNull(
  read: () => Promise<DocumentSnapshot>
): Promise<DocumentSnapshot | null> {
  try {
    return await read();
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

async function readQueryOrEmpty(
  read: () => Promise<QuerySnapshot>
): Promise<QuerySnapshot | null> {
  try {
    return await read();
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function createBet(params: {
  userId: string;
  guildId: string;
  amount: number;
  pixKey: string;
  pixKeyType: PixKeyType;
  pixOwnerDocument: string;
}): Promise<BetEntry> {
  const betId = generateId();
  const now = Date.now();
  const bet: BetEntry = {
    betId,
    userId: params.userId,
    guildId: params.guildId,
    amount: params.amount,
    pixKey: params.pixKey,
    pixKeyType: params.pixKeyType,
    pixOwnerDocument: params.pixOwnerDocument,
    status: "aguardando_pagamento",
    createdAt: now,
    updatedAt: now,
  };

  await db.collection(BETS_COLLECTION).doc(betId).set(bet, { merge: true });
  return bet;
}

export async function getBet(betId: string): Promise<BetEntry | null> {
  const doc = await readDocumentOrNull(() => db.collection(BETS_COLLECTION).doc(betId).get());
  return doc?.exists ? (doc.data() as BetEntry) : null;
}

export async function findBetByPaymentId(paymentId: string): Promise<BetEntry | null> {
  const snapshot = await readQueryOrEmpty(() =>
    db.collection(BETS_COLLECTION).where("paymentId", "==", paymentId).limit(1).get()
  );
  return !snapshot || snapshot.empty ? null : (snapshot.docs[0].data() as BetEntry);
}

export async function updateBet(betId: string, patch: Partial<BetEntry>): Promise<void> {
  await db.collection(BETS_COLLECTION).doc(betId).set(
    { ...patch, updatedAt: Date.now() },
    { merge: true }
  );
}

export async function setBetStatus(betId: string, status: BetStatus): Promise<void> {
  await updateBet(betId, { status });
}

function docToWaitingBet(doc: QueryDocumentSnapshot): WaitingBet {
  return doc.data() as WaitingBet;
}

export async function joinBetQueue(
  bet: WaitingBet
): Promise<{ waitingBet: WaitingBet; newBet: WaitingBet } | null> {
  const collectionRef = db.collection(QUEUE_COLLECTION);

  return db.runTransaction(async (tx: Transaction) => {
    const oldestQuery: Query = collectionRef
      .where("amount", "==", bet.amount)
      .orderBy("joinedAt", "asc")
      .limit(1);
    let snapshot;
    try {
      snapshot = await tx.get(oldestQuery);
    } catch (error) {
      if (isNotFound(error)) {
        tx.set(collectionRef.doc(bet.betId), bet, { merge: true });
        return null;
      }
      throw error;
    }

    if (snapshot.empty) {
      tx.set(collectionRef.doc(bet.betId), bet, { merge: true });
      return null;
    }

    const waitingDoc = snapshot.docs[0];
    const waitingBet = docToWaitingBet(waitingDoc);
    tx.delete(waitingDoc.ref);
    return { waitingBet, newBet: bet };
  });
}

export async function leaveBetQueue(userId: string): Promise<WaitingBet | null> {
  const snapshot = await readQueryOrEmpty(() =>
    db.collection(QUEUE_COLLECTION).where("userId", "==", userId).limit(1).get()
  );
  if (!snapshot || snapshot.empty) return null;

  const doc = snapshot.docs[0];
  const bet = docToWaitingBet(doc);
  await doc.ref.delete();
  return bet;
}

export async function isPlayerInBetQueue(userId: string): Promise<boolean> {
  const snapshot = await readQueryOrEmpty(() =>
    db.collection(QUEUE_COLLECTION).where("userId", "==", userId).limit(1).get()
  );
  return Boolean(snapshot && !snapshot.empty);
}

export async function listWaitingBets(): Promise<WaitingBet[]> {
  const snapshot = await readQueryOrEmpty(() =>
    db.collection(QUEUE_COLLECTION).orderBy("joinedAt", "asc").get()
  );
  return snapshot?.docs.map(docToWaitingBet) ?? [];
}

export async function requeueBet(bet: WaitingBet): Promise<void> {
  await db.collection(QUEUE_COLLECTION).doc(bet.betId).set(
    { ...bet, joinedAt: Date.now() },
    { merge: true }
  );
}

export async function purgeInactiveBets(): Promise<WaitingBet[]> {
  const cutoff = Date.now() - config.queue.betQueueTimeoutMs;
  const snapshot = await readQueryOrEmpty(() =>
    db.collection(QUEUE_COLLECTION).where("joinedAt", "<=", cutoff).get()
  );
  if (!snapshot || snapshot.empty) return [];

  const removed = snapshot.docs.map(docToWaitingBet);
  const batch = db.batch();
  snapshot.docs.forEach((doc: QueryDocumentSnapshot) => batch.delete(doc.ref));
  await batch.commit();
  return removed;
}

export function startBetQueueInactivityWatcher(onRemoved: (bets: WaitingBet[]) => void): void {
  setInterval(() => {
    purgeInactiveBets()
      .then((removed) => {
        if (removed.length > 0) onRemoved(removed);
      })
      .catch((err) => console.error("[BetLedger] Erro ao varrer apostas inativas:", err));
  }, config.queue.betQueueTimeoutCheckIntervalMs);
}
