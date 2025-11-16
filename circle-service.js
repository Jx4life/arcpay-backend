// circle-service.js
import { initiateUserControlledWalletsClient } from '@circle-fin/user-controlled-wallets';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';

dotenv.config();

const client = initiateUserControlledWalletsClient({
  apiKey: process.env.CIRCLE_API_KEY,
});

// In-memory storage
const users = new Map();

export async function createCircleUser(email) {
  try {
    const existingUser = users.get(email);
    if (existingUser) {
      console.log('User already exists, returning existing data');
      return existingUser;
    }

    const internalUserId = `user-${uuidv4()}`;
    
    console.log('Creating Circle user with ID:', internalUserId);
    
    // Create user entity
    const response = await client.createUser({
      userId: internalUserId,
    });

    console.log('✅ Circle user created:', response.data);

    // Get user token and encryption key
    const tokenResponse = await client.createUserToken({
      userId: internalUserId,
    });

    console.log('✅ User token created');

    const userData = {
      internalUserId,
      circleUserId: internalUserId,
      token: tokenResponse.data?.userToken,
      encryptionKey: tokenResponse.data?.encryptionKey,
      email,
      createdAt: new Date().toISOString(),
    };

    users.set(email, userData);
    users.set(internalUserId, userData);

    console.log('✅ User stored in memory');

    return userData;
  } catch (error) {
    console.error('Error creating Circle user:', error.response?.data || error.message);
    throw new Error(`Failed to create Circle user: ${error.message}`);
  }
}

export async function initializeUser(userId) {
  try {
    const user = users.get(userId);
    
    if (!user) {
      throw new Error('User not found in storage');
    }

    console.log('Initializing user and creating wallet:', userId);

    // Create user PIN and wallet in one call
    const response = await client.createUserPinWithWallets({
      userId: userId,
      blockchains: ['ARB-SEPOLIA'],
      accountType: 'SCA', // Use SCA instead of EOA
      metadata: [{
        name: 'ArcPay Wallet',
        refId: `arcpay-${uuidv4().slice(0, 8)}`,
      }],
    });

    console.log('✅ User initialized, challengeId:', response.data?.challengeId);

    return {
      challengeId: response.data?.challengeId,
      success: true,
    };
  } catch (error) {
    console.error('Error initializing user:', error.response?.data || error.message);
    throw new Error(`Failed to initialize user: ${error.message}`);
  }
}

export async function createUserWallet(userId, blockchain = 'ARB-SEPOLIA') {
  try {
    const user = users.get(userId);
    
    if (!user) {
      throw new Error('User not found in storage');
    }

    console.log('Creating additional wallet for user:', userId);

    const response = await client.createWallets({
      userId: userId,
      blockchains: [blockchain],
      accountType: 'SCA',
      metadata: [{
        name: `ArcPay Wallet - ${blockchain}`,
        refId: `arcpay-${blockchain.toLowerCase()}-${uuidv4().slice(0, 8)}`,
      }],
    });

    console.log('✅ Additional wallet created, challengeId:', response.data?.challengeId);

    return {
      challengeId: response.data?.challengeId,
    };
  } catch (error) {
    console.error('Error creating wallet:', error.response?.data || error.message);
    throw new Error(`Failed to create wallet: ${error.message}`);
  }
}

export async function getUserWallets(userId) {
  try {
    const user = users.get(userId);
    
    if (!user) {
      throw new Error('User not found in storage');
    }

    console.log('Fetching wallets for user:', userId);

    const response = await client.listWallets({
      userId: userId,
      pageSize: 10,
    });

    console.log('✅ Found wallets:', response.data?.wallets?.length || 0);

    return response.data?.wallets || [];
  } catch (error) {
    console.error('Error fetching wallets:', error.response?.data || error.message);
    throw new Error(`Failed to get wallets: ${error.message}`);
  }
}

export function getUserByEmail(email) {
  return users.get(email);
}

export function getUserById(userId) {
  return users.get(userId);
}