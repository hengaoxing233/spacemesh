const crypto = require("crypto");
const Bech32 = require("@spacemesh/address-wasm");
const bip32 = require("@spacemesh/ed25519-bip32");
const pkg = require("@spacemesh/sm-codec");
const bip39 = require("bip39");
const {
    ChannelCredentials,
    createChannel,
    createClient,
} = require("nice-grpc");
const {
    AccountDataFlag,
    toHexString,
    GlobalStateServiceDefinition,
    MeshServiceDefinition,
    TransactionServiceDefinition,
    fromHexString,
    TransactionState_TransactionState,
} = require("@andreivcodes/spacemeshlib");

// public node: pub-node1.smesh.cloud:9092
const networkUrl = '127.0.0.1:9003';

(async () => {
    Bech32.default.init()
    Bech32.default.setHRPNetwork("sm");
})();



async function main() {
    const _mnemonic = '';
    let to = "";
    let amount = 1 * 1000000000;//转账1个SMH
    await sendSmesh({ to: to, amount: amount, mnemonic: _mnemonic});
    await Spawn({ mnemonic: _mnemonic});
    let txid = "";
    await checkTx({ tx: txid });
}

const COIN_TYPE = 540;
const BIP_PROPOSAL = 44;
const path = `m/${BIP_PROPOSAL}'/${COIN_TYPE}'/0'/0'/${0}'`;



const sendSmesh = async ({ to, amount, mnemonic }) => {
    const seed = bip39.mnemonicToSeedSync(mnemonic);

    const p0 = await bip32.derive_key(seed, path);
    const publicKey = p0.slice(32);
    const secretKey = p0;
    const tpl = pkg.TemplateRegistry.get(pkg.SingleSigTemplate.key, 16);
    const principal = tpl.principal({
        PublicKey: publicKey,
    });

    const address = Bech32.default.generateAddress(principal);
    const channel = createChannel(
        `${networkUrl}`,
        ChannelCredentials.createInsecure()
    );
    const globalStateClient = createClient(GlobalStateServiceDefinition, channel);
    const meshClient = createClient(MeshServiceDefinition, channel);
    const txClient = createClient(TransactionServiceDefinition, channel);
    const accountQueryResponse = await globalStateClient.accountDataQuery({
        filter: {
            accountId: {
                address: address,
            },
            accountDataFlags: AccountDataFlag.ACCOUNT_DATA_FLAG_ACCOUNT,
        }
    });

    let accountNonce = Number(
        accountQueryResponse.accountItem[0].accountWrapper?.stateProjected?.counter
    );
    let accountBalance = Number(
        accountQueryResponse.accountItem[0].accountWrapper?.stateProjected?.balance?.value
    );

    console.log(
        `当前地址 ${address} nonce ${accountNonce} 余额 ${accountBalance/1000000000} SMH`
    );

    if (Number(accountBalance) < amount) {
        console.log(`转账余额不足`);
        return;
    }

    const payload = {
        Arguments: {
            Destination: Bech32.default.parse(to),
            Amount: BigInt(amount),
        },
        Nonce: BigInt(accountNonce),
        GasPrice: BigInt(1),
    };

    const encodedTx = tpl.encode(principal, payload);
    const genesisID = await (await meshClient.genesisID({})).genesisId;
    const sig = sign(
        new Uint8Array([...genesisID, ...encodedTx]),
        toHexString(secretKey)
    );
    const signed = tpl.sign(encodedTx, sig);

    txClient
        .submitTransaction({ transaction: signed })
        .then((response) => {
            console.log(
                `转账发送成功,交易ID: 0x${toHexString(response.txstate?.id?.id)}`
            );
        })
        .catch((err) => {
            console.log(`转账发送失败`);
            console.log(err);
        });
};

const Spawn = async ({mnemonic}) => {
    const seed = bip39.mnemonicToSeedSync(mnemonic);

    const p0 = await bip32.derive_key(seed, path);
    const publicKey = p0.slice(32);
    const secretKey = p0;
    const tpl = pkg.TemplateRegistry.get(pkg.SingleSigTemplate.key, 0);
    const spawnArgs = {
        PublicKey: publicKey,
    };
    const principal = tpl.principal(spawnArgs);

    const address = Bech32.default.generateAddress(principal);
    const channel = createChannel(
        `${networkUrl}`,
        ChannelCredentials.createInsecure()
    );
    const globalStateClient = createClient(GlobalStateServiceDefinition, channel);
    const meshClient = createClient(MeshServiceDefinition, channel);
    const txClient = createClient(TransactionServiceDefinition, channel);
    const accountQueryResponse = await globalStateClient.accountDataQuery({
        filter: {
            accountId: {
                address: address,
            },
            accountDataFlags: AccountDataFlag.ACCOUNT_DATA_FLAG_ACCOUNT,
        }
    });

    let accountNonce = Number(
        accountQueryResponse.accountItem[0].accountWrapper?.stateProjected?.counter
    );
    let accountBalance = Number(
        accountQueryResponse.accountItem[0].accountWrapper?.stateProjected?.balance?.value
    );

    console.log(
        `当前地址 ${address} nonce ${accountNonce} 余额 ${accountBalance/1000000000} SMH`
    );

    const payload = {
        Nonce: BigInt(accountNonce),
        GasPrice: BigInt(1),
        Arguments: spawnArgs,
    };
    const encodedTx = tpl.encode(principal, payload);
    const genesisID = await (await meshClient.genesisID({})).genesisId;
    const sig = sign(
        new Uint8Array([...genesisID, ...encodedTx]),
        toHexString(secretKey)
    );
    const signed = tpl.sign(encodedTx, sig);

    txClient
        .submitTransaction({ transaction: signed })
        .then((response) => {
            console.log(
                `激活发送成功,交易ID: 0x${toHexString(response.txstate?.id?.id)}`
            );
        })
        .catch((err) => {
            console.log(`激活发送失败`);
            console.log(err);
        });
};

const checkTx = async ({ tx }) => {
    const channel = createChannel(
        `${networkUrl}`,
        ChannelCredentials.createInsecure()
    );
    const txClient = createClient(TransactionServiceDefinition, channel);

    txClient
        .transactionsState({
            transactionId: [{ id: fromHexString(tx.substring(2)) }],
        })
        .then((res) => {
            switch (res.transactionsState[0].state) {
                case TransactionState_TransactionState.TRANSACTION_STATE_UNSPECIFIED:
                    console.log(`交易状态:等待中`);
                    break;
                case TransactionState_TransactionState.TRANSACTION_STATE_REJECTED:
                    console.log(`交易状态:拒绝`);
                    break;
                case TransactionState_TransactionState.TRANSACTION_STATE_INSUFFICIENT_FUNDS:
                    console.log(`交易状态:资金不足`);
                    break;
                case TransactionState_TransactionState.TRANSACTION_STATE_MEMPOOL:
                    console.log(`交易状态:已提交到内存池`);
                    break;
                case TransactionState_TransactionState.TRANSACTION_STATE_CONFLICTING:
                    console.log(`交易状态:由于计数器冲突而被内存池拒绝`);
                    break;
                case TransactionState_TransactionState.TRANSACTION_STATE_MESH:
                    console.log(`交易状态:已提交到MESH`);
                    break;
                case TransactionState_TransactionState.TRANSACTION_STATE_PROCESSED:
                    console.log(`交易状态:成功`);
                    break;
                default:
                    console.log(`交易状态:未知`);
                    break;
            }
        });
};

const sign = (dataBytes, privateKey) => {
    const key = Buffer.concat([
        Buffer.from("302e020100300506032b657004220420", "hex"),
        Buffer.from(privateKey, "hex"),
    ]);
    const pk = crypto.createPrivateKey({
        format: "der",
        type: "pkcs8",
        key,
    });
    return Uint8Array.from(crypto.sign(null, dataBytes, pk));
};

main();
