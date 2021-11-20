import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
  Signer
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  MintLayout,
  Token
} from "@solana/spl-token";
import {
  Data,
  CreateMetadataArgs,
  METADATA_SCHEMA as SERIALIZE_SCHEMA
} from "./schema";
import { serialize } from "borsh";
import { createMetadataInstruction } from "./utils";
import { readFileSync } from "fs";

const DECIMALS = 2;

const METAPLEX_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  let connection = new Connection("https://api.devnet.solana.com", "confirmed");

  let mintId = new Keypair();
  console.log(`Mint ID: ${mintId.publicKey.toString()}`);

  const secret = JSON.parse(readFileSync("<PRIVATE_KEY>.json", "utf8"));
  const mintAuthority = Keypair.fromSecretKey(Uint8Array.from(secret));

  const data = new Data({
    symbol: "ALICE",
    name: "0xAlice",
    uri: "",
    sellerFeeBasisPoints: 0,
    creators: null
  });

  await createDecoratedSPL(connection, mintId, mintAuthority, data);

  let user = new PublicKey("<USER_ADDRESS>");
  let amount = 1300;

  await mintSomeTokens(
    connection,
    mintAuthority,
    mintId.publicKey,
    amount,
    user
  );

  // Could also create a token object and use it to mint
  // const token = new Token(
  //   connection,
  //   mintId.publicKey,
  //   TOKEN_PROGRAM_ID,
  //   mintAuthority
  // );
  // token.mintTo()
}

async function createDecoratedSPL(
  connection: Connection,
  mintId: Keypair,
  mintAuthority: Keypair,
  data: Data
): Promise<void> {
  // Allocate memory for the account
  const mintRent = await connection.getMinimumBalanceForRentExemption(
    MintLayout.span
  );

  // Create mint account
  const createMintAccountIx = SystemProgram.createAccount({
    fromPubkey: mintAuthority.publicKey,
    newAccountPubkey: mintId.publicKey,
    lamports: mintRent,
    space: MintLayout.span,
    programId: TOKEN_PROGRAM_ID
  });

  // Initalize mint ix
  // Creator keypair is mint and freeze authority
  const initMintIx = Token.createInitMintInstruction(
    TOKEN_PROGRAM_ID,
    mintId.publicKey,
    DECIMALS,
    mintAuthority.publicKey,
    null
  );

  // Derive metadata account
  const metadataSeeds = [
    Buffer.from("metadata"),
    METAPLEX_PROGRAM_ID.toBuffer(),
    mintId.publicKey.toBuffer()
  ];
  const [metadataAccount, _pda] = await PublicKey.findProgramAddress(
    metadataSeeds,
    METAPLEX_PROGRAM_ID
  );

  let buffer = Buffer.from(
    serialize(
      SERIALIZE_SCHEMA,
      new CreateMetadataArgs({ data, isMutable: true })
    )
  );

  // Create metadata account ix
  const createMetadataIx = createMetadataInstruction(
    metadataAccount,
    mintId.publicKey,
    mintAuthority.publicKey,
    mintAuthority.publicKey,
    mintAuthority.publicKey,
    buffer
  );

  let tx = new Transaction()
    .add(createMintAccountIx)
    .add(initMintIx)
    .add(createMetadataIx);

  const recent = await connection.getRecentBlockhash();
  tx.recentBlockhash = recent.blockhash;
  tx.feePayer = mintAuthority.publicKey;

  tx.sign(mintId, mintAuthority);

  const txSignature = await connection.sendRawTransaction(tx.serialize());
  console.log(txSignature);
  await connection.confirmTransaction(txSignature);
}

async function mintSomeTokens(
  connection: Connection,
  authority: Signer,
  mint: PublicKey,
  amount: number,
  user: PublicKey
) {
  // Derive associated token account for user
  const assoc = await Token.getAssociatedTokenAddress(
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    mint,
    user
  );

  // Create associated account for user
  const createAssocTokenAccountIx =
    Token.createAssociatedTokenAccountInstruction(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      mint,
      assoc,
      user,
      authority.publicKey
    );

  // Create mintTo ix; mint to user's associated account
  const mintToIx = Token.createMintToInstruction(
    TOKEN_PROGRAM_ID,
    mint,
    assoc,
    authority.publicKey, // Mint authority
    [], // No multi-sign signers
    amount
  );

  let tx = new Transaction().add(createAssocTokenAccountIx).add(mintToIx);
  const recent = await connection.getRecentBlockhash();
  tx.recentBlockhash = recent.blockhash;
  tx.feePayer = authority.publicKey;

  tx.sign(authority);

  const txSignature = await connection.sendRawTransaction(tx.serialize());
  console.log(txSignature);
}

main().then(() => console.log("Success"));
