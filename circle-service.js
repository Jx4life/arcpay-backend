import { initiateUserControlledWalletsClient } from '@circle-fin/user-controlled-wallets';
import { v4 as uuidv4 } from 'uuid';

const client = initiateUserControlledWalletsClient({
  apiKey: process.env.CIRCLE_API_KEY,
});

export async function createCircleUser(email) {
  try {
    const internalUserId = `user-${uuidv4()}`;
    
    const response = await client.createUser({
      userId: internalUserId,
    });

    console.log('Circle Response:', response.data);

    return {
      internalUserId,
      circleUserId: response.data?.user?.id || response.data?.id,
      token: response.data?.user?.token || response.data?.token,
    };
  } catch (error) {
    console.error('Error creating Circle user:', error);
    throw error;
  }
}

export async function createUserWallet(userId, blockchain = 'ARB-SEPOLIA') {
  try {
    const response = await client.createUserPinWithWallets({
      userId,
      blockchains: [blockchain],
      accountType: 'EOA',
      metadata: [{
        name: 'ArcPay Wallet',
        refId: `arcpay-${uuidv4().slice(0, 8)}`,
      }],
    });

    return {
      challengeId: response.data.challengeId,
    };
  } catch (error) {
    console.error('Error creating wallet:', error);
    throw error;
  }
}

export async function getUserWallets(userId) {
  try {
    const response = await client.listWallets({
      userId,
      pageSize: 10,
    });

    return response.data.wallets;
  } catch (error) {
    console.error('Error fetching wallets:', error);
    throw error;
  }
}
