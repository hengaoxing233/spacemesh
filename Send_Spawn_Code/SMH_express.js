const { performance } = require('perf_hooks');
globalThis.performance = performance;
const AbortController = require('abort-controller');
globalThis.AbortController = AbortController;
var express = require('express');
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
    NodeServiceDefinition,
    fromHexString,
    TransactionState_TransactionState,
} = require("@andreivcodes/spacemeshlib");
const {json} = require("express");

// 初始化 express 和端口号
var app = express();

// 调用 express.json() 方法进行解析
app.use(express.json());


const COIN_TYPE = 540;
const BIP_PROPOSAL = 44;
const path = `m/${BIP_PROPOSAL}'/${COIN_TYPE}'/0'/0'/${0}'`;

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
app.post('/getadderss', async function (req, res) {
    try {
        var mnemonic = req.body.mnemonic;
        const seed = bip39.mnemonicToSeedSync(mnemonic);
        const p0 = await bip32.derive_key(seed, path);
        const publicKey = p0.slice(32);
        const secretKey = p0;
        const tpl = pkg.TemplateRegistry.get(pkg.SingleSigTemplate.key, 16);
        const principal = tpl.principal({
            PublicKey: publicKey,
        });
        const address = Bech32.default.generateAddress(principal);
        res.send({"code":1,"msg":address});
    }catch (e) {
        res.send({"code":0,"msg":e.toString()});
    }
})

app.post('/spawn', async function (req, res) {
    try {
        var mnemonic = req.body.mnemonic;
        var networkUrl = req.body.networkUrl;
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
                res.send({"code":1,"txid":`0x${toHexString(response.txstate?.id?.id)}`});
            })
            .catch((err) => {
                console.log(`激活发送失败:${err.toString()}`, );
                res.send({"code":0,"msg":err.toString()});
            });

    }catch (e) {
        res.send({"code":0,"msg":e.toString()});
    }
})

app.post('/sendsmh', async function (req, res) {
    try {
        var mnemonic = req.body.mnemonic;
        var networkUrl = req.body.networkUrl;
        var to = req.body.to;
        var amount = req.body.amount;
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
            res.send({"code":0,"msg":"转账余额不足"});
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
                res.send({"code":1,"msg":`0x${toHexString(response.txstate?.id?.id)}`});
            })
            .catch((err) => {
                console.log(`转账发送失败${err.toString()}`);
                res.send({"code":0,"msg":`${err.toString()}`});
            });

    }catch (e) {
        res.send({"code":0,"msg":e.toString()});
    }
})

app.post('/getbalance', async function (req, res) {
    try {
        var address = req.body.address;
        var networkUrl = req.body.networkUrl;
        const channel = createChannel(
            `${networkUrl}`,
            ChannelCredentials.createInsecure()
        );
        const globalStateClient = createClient(GlobalStateServiceDefinition, channel);
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
        res.send({"code":1,"msg":`${accountBalance/1000000000}`});
    }catch (e) {
        res.send({"code":0,"msg":e.toString()});
    }
})

app.post('/checkTx', async function (req, res) {
    try {
        var tx = req.body.txid;
        var networkUrl = req.body.networkUrl;
        const channel = createChannel(
            `${networkUrl}`,
            ChannelCredentials.createInsecure()
        );
        const txClient = createClient(TransactionServiceDefinition, channel);

        txClient
            .transactionsState({
                transactionId: [{ id: fromHexString(tx.substring(2)) }],
            })
            .then((res1) => {
                switch (res1.transactionsState[0].state) {
                    case TransactionState_TransactionState.TRANSACTION_STATE_UNSPECIFIED:
                        console.log(`交易状态:等待中`);
                        res.send({"code":2,"msg":`等待中`});
                        return;
                    case TransactionState_TransactionState.TRANSACTION_STATE_REJECTED:
                        console.log(`交易状态:拒绝`);
                        res.send({"code":0,"msg":`拒绝`});
                        return;
                    case TransactionState_TransactionState.TRANSACTION_STATE_INSUFFICIENT_FUNDS:
                        console.log(`交易状态:资金不足`);
                        res.send({"code":0,"msg":`资金不足`});
                        return;
                    case TransactionState_TransactionState.TRANSACTION_STATE_MEMPOOL:
                        console.log(`交易状态:已提交到内存池`);
                        res.send({"code":2,"msg":`已提交到内存池`});
                        return;
                    case TransactionState_TransactionState.TRANSACTION_STATE_CONFLICTING:
                        console.log(`交易状态:由于计数器冲突而被内存池拒绝`);
                        res.send({"code":0,"msg":`由于计数器冲突而被内存池拒绝`});
                        return;
                    case TransactionState_TransactionState.TRANSACTION_STATE_MESH:
                        console.log(`交易状态:已提交到MESH`);
                        res.send({"code":2,"msg":`已提交到MESH`});
                        return;
                    case TransactionState_TransactionState.TRANSACTION_STATE_PROCESSED:
                        console.log(`交易状态:成功`);
                        res.send({"code":1,"msg":`成功`});
                        return;
                    default:
                        console.log(`交易状态:未知`);
                        res.send({"code":0,"msg":`未知`});
                        return;
                }
            });

    }catch (e) {
        res.send({"code":0,"msg":e.toString()});
    }
})

app.post('/checkNet', async function (req, res) {
    try {
        var networkUrl = req.body.networkUrl;
        const channel = createChannel(
            `${networkUrl}`,
            ChannelCredentials.createInsecure()
        );
        const nodeClient = createClient(NodeServiceDefinition, channel);
        const nodeStatusResponse = await nodeClient.status();
        const nodeVersionResponse = await nodeClient.version();
        let isSynced = nodeStatusResponse.status.isSynced;
        let connectedPeers = nodeStatusResponse.status.connectedPeers.toString();
        let syncedLayer = nodeStatusResponse.status.syncedLayer.number.toString();
        let topLayer = nodeStatusResponse.status.topLayer.number.toString();
        let verifiedLayer = nodeStatusResponse.status.verifiedLayer.number.toString();
        if (isSynced === undefined || isSynced === ""){
            isSynced = false
        }
        let version = nodeVersionResponse.versionString.value
        console.log({"code":1,"同步":isSynced,"连接数":connectedPeers, "同步层":syncedLayer,"总层数":topLayer,"验证层":verifiedLayer,"版本":version})
        res.send({"code":1,"同步":isSynced,"连接数":connectedPeers, "同步层":syncedLayer,"总层数":topLayer,"验证层":verifiedLayer,"版本":version});
    }catch (e) {
        res.send({"code":0,"msg":e.toString()});
    }
})
// 监听端口
var PORT = 8111;
app.listen(PORT, function(err){
    if (err) console.log(err);
    console.log("服务监听端口:", PORT);
});
