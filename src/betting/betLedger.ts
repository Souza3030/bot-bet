import { db } from "../firebase/admin";
import type { Query, QueryDocumentSnapshot, Transaction } from "firebase-admin/firestore";
import { config } from "../config";
import { BetEntry, BetStatus, PixKeyType, WaitingBet } from "../types";

const BETS_COLLECTION = "soloBets";
const QUEUE_COLLECTION = "soloBetQueue";

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Registro de apostas (auditoria/estado completo de cada aposta)
// ---------------------------------------------------------------------------

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

  await db.collection(BETS_COLLECTION).doc(betId).set(bet);
  return bet;
}

export async function getBet(betId: string): Promise<BetEntry | null> {
  const doc = await db.collection(BETS_COLLECTION).doc(betId).get();
  return doc.exists ? (doc.data() as BetEntry) : null;
}

export async function findBetByPaymentId(paymentId: string): Promise<BetEntry | null> {
  const snapshot = await db
    .collection(BETS_COLLECTION)
    .where("paymentId", "==", paymentId)
    .limit(1)
    .get();

  return snapshot.empty ? null : (snapshot.docs[0].data() as BetEntry);
}

export async function updateBet(betId: string, patch: Partial<BetEntry>): Promise<void> {
  await db
    .collection(BETS_COLLECTION)
    .doc(betId)
    .set({ ...patch, updatedAt: Date.now() }, { merge: true });
}

export async function setBetStatus(betId: string, status: BetStatus): Promise<void> {
  await updateBet(betId, { status });
}

// ---------------------------------------------------------------------------
// Fila de pareamento — só entram apostas já pagas (webhook confirmado).
// Só casa apostas de MESMO valor.
// ---------------------------------------------------------------------------

function docToWaitingBet(doc: QueryDocumentSnapshot): WaitingBet {
  return doc.data() as WaitingBet;
}

/**
 * Tenta colocar uma aposta paga na fila.
 *
 * - Se já existir outra aposta do MESMO valor esperando, ela é retirada da
 *   fila dentro de uma transação e as duas são retornadas como um par
 *   pronto para o check-in.
 * - Se não houver adversário do mesmo valor, a aposta é gravada na fila e
 *   o método retorna `null` (aguardando).
 */
export async function joinBetQueue(
  bet: WaitingBet
): Promise<{ waitingBet: WaitingBet; newBet: WaitingBet } | null> {
  const collectionRef = db.collection(QUEUE_COLLECTION);

  return db.runTransaction(async (tx: Transaction) => {
    const oldestQuery: Query = collectionRef
      .where("amount", "==", bet.amount)
      .orderBy("joinedAt", "asc")
      .limit(1);
    const snapshot = await tx.get(oldestQuery);

    if (snapshot.empty) {
      tx.set(collectionRef.doc(bet.betId), bet);
      return null;
    }

    const waitingDoc = snapshot.docs[0];
    const waitingBet = docToWaitingBet(waitingDoc);
    tx.delete(waitingDoc.ref);

    return { waitingBet, newBet: bet };
  });
}

/** Remove da fila a aposta de um jogador específico (se ainda não pareada). */
export async function leaveBetQueue(userId: string): Promise<WaitingBet | null> {
  const snapshot = await db
    .collection(QUEUE_COLLECTION)
    .where("userId", "==", userId)
    .limit(1)
    .get();

  if (snapshot.empty) return null;

  const doc = snapshot.docs[0];
  const bet = docToWaitingBet(doc);
  await doc.ref.delete();
  return bet;
}

export async function isPlayerInBetQueue(userId: string): Promise<boolean> {
  const snapshot = await db
    .collection(QUEUE_COLLECTION)
    .where("userId", "==", userId)
    .limit(1)
    .get();
  return !snapshot.empty;
}

export async function listWaitingBets(): Promise<WaitingBet[]> {
  const snapshot = await db.collection(QUEUE_COLLECTION).orderBy("joinedAt", "asc").get();
  return snapshot.docs.map(docToWaitingBet);
}

/** Recoloca uma aposta de volta na fila (ex: adversário não fez check-in). */
export async function requeueBet(bet: WaitingBet): Promise<void> {
  await db
    .collection(QUEUE_COLLECTION)
    .doc(bet.betId)
    .set({ ...bet, joinedAt: Date.now() });
}

/** Remove apostas que esperaram além do tempo limite (para reembolso). */
export async function purgeInactiveBets(): Promise<WaitingBet[]> {
  const cutoff = Date.now() - config.queue.betQueueTimeoutMs;
  const snapshot = await db.collection(QUEUE_COLLECTION).where("joinedAt", "<=", cutoff).get();

  if (snapshot.empty) return [];

  const removed = snapshot.docs.map(docToWaitingBet);
  const batch = db.batch();
  snapshot.docs.forEach((doc) => batch.delete(doc.ref));
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
