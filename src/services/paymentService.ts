import { config } from '../config';
import { PaymentProvider, TransactionStatus } from '../types';
import { Prisma } from '@prisma/client';
import prisma from '../config/database';

export interface PaymentResult {
  success: boolean;
  reference: string;
  transactionId: string;
  error?: string;
}

export interface PaymentProviderInterface {
  name: PaymentProvider;
  processPayment(amount: number, currency: string, reference: string, metadata?: Record<string, unknown>): Promise<PaymentResult>;
  refund(transactionId: string, amount: number): Promise<PaymentResult>;
}

class MockPaymentProvider implements PaymentProviderInterface {
  name = PaymentProvider.MOCK as PaymentProvider;

  async processPayment(
    amount: number,
    currency: string,
    reference: string,
    metadata?: Record<string, unknown>
  ): Promise<PaymentResult> {
    const simulateFailure = metadata?.simulateFailure === true;

    await new Promise((resolve) => setTimeout(resolve, 500));

    if (simulateFailure) {
      return {
        success: false,
        reference,
        transactionId: '',
        error: 'Simulated payment failure',
      };
    }

    const transactionId = `MOCK-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    return {
      success: true,
      reference,
      transactionId,
    };
  }

  async refund(transactionId: string, amount: number): Promise<PaymentResult> {
    await new Promise((resolve) => setTimeout(resolve, 300));

    return {
      success: true,
      reference: `REFUND-${transactionId}`,
      transactionId: `REF-${Date.now()}`,
    };
  }
}

const providers: Record<PaymentProvider, PaymentProviderInterface> = {
  [PaymentProvider.MOCK]: new MockPaymentProvider(),
  [PaymentProvider.MOBILE_MONEY]: new MockPaymentProvider(),
  [PaymentProvider.CARD]: new MockPaymentProvider(),
};

export function getPaymentProvider(provider: PaymentProvider): PaymentProviderInterface {
  return providers[provider] || providers[PaymentProvider.MOCK];
}

export async function processPayment(
  jobId: string,
  amount: number,
  currency: string,
  provider: PaymentProvider,
  reference: string,
  metadata?: Record<string, unknown>
): Promise<PaymentResult> {
  const paymentProvider = getPaymentProvider(provider);

  const transaction = await prisma.paymentTransaction.create({
    data: {
      jobId,
      provider,
      reference,
      amount,
      currency,
      status: TransactionStatus.PENDING,
      metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : undefined,
    },
  });

  try {
    const result = await paymentProvider.processPayment(amount, currency, reference, metadata);

    await prisma.paymentTransaction.update({
      where: { id: transaction.id },
      data: {
        status: result.success ? TransactionStatus.SUCCESS : TransactionStatus.FAILED,
        metadata: JSON.parse(JSON.stringify({
          ...(metadata || {}),
          result: result.success ? 'success' : 'failed',
          error: result.error,
          transactionId: result.transactionId,
        })),
      },
    });

    return result;
  } catch (error) {
    await prisma.paymentTransaction.update({
      where: { id: transaction.id },
      data: {
        status: TransactionStatus.FAILED,
        metadata: JSON.parse(JSON.stringify({
          ...(metadata || {}),
          error: error instanceof Error ? error.message : 'Unknown error',
        })),
      },
    });

    throw error;
  }
}

export async function refundPayment(transactionId: string, amount: number): Promise<PaymentResult> {
  const transaction = await prisma.paymentTransaction.findUnique({
    where: { id: transactionId },
  });

  if (!transaction) {
    return {
      success: false,
      reference: '',
      transactionId: '',
      error: 'Transaction not found',
    };
  }

  const provider = getPaymentProvider(transaction.provider as PaymentProvider);
  const result = await provider.refund(transactionId, amount);

  if (result.success) {
    await prisma.paymentTransaction.update({
      where: { id: transactionId },
      data: { status: TransactionStatus.REFUNDED },
    });
  }

  return result;
}
