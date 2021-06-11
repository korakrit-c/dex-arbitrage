const ethers = require('ethers');
const Web3 = require('web3');
const pancakeAbiDecoder = require('abi-decoder');
const twindexAbiDecoder = require('abi-decoder');
const colors = require("colors");
const Tx = require('@ethereumjs/tx').Transaction;
const axios = require('axios');
const BigNumber = require('big-number');
//require('log-timestamp');

const {NETWORK, HTTP_PROVIDER_LINK,WEBSOCKET_PROVIDER_LINK,PANCAKE_ROUTER_ADDRESS,PANCAKE_FACTORY_ADDRESS,PANCAKE_ROUTER_ABI,PANCAKE_FACTORY_ABI,PANCAKE_POOL_ABI,TWINDEX_ROUTER_ADDRESS,TWINDEX_FACTORY_ADDRESS,TWINDEX_ROUTER_ABI,TWINDEX_FACTORY_ABI,TWINDEX_POOL_AB} = require('./constants.js');
const {PRIVATE_KEY, TOKEN_ADDRESS, STABLE_TOKEN_ADDRESS, WBNB_TOKEN_ADDRESS, AMOUNT, LEVEL, TRIGGER_DIFFERENT_PRICE, TRIGGER_DIFFERENT_PRICE_PERCENTAGE, SLIPPAGE_TOLERANCE} = require('./env.js');

/* Global variables */
const ONE_GWEI = 1e9; // (1000000000) one gwei
let GAS_INFO;

let web3, web3Ws;
let pancakeRouter, pancakeFactory;
let twindexRouter, twindexFactory;
let userWallet;
let tokenInfo1, tokenInfo2;
let poolInfo;

/* Create providers */
const provider = new ethers.providers.JsonRpcProvider(HTTP_PROVIDER_LINK);
//const providerWs = new ethers.providers.WebSocketProvider(WEBSOCKET_PROVIDER_LINK);

let Contract = {
    PancakePair: new ethers.Contract('0xb694ec7C2a7C433E69200b1dA3EBc86907B4578B',[
        'function getReserves() public view returns (uint112 _reserve0, uint112 _reserve1, uint32 _blockTimestampLast)',
        'function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)'
    ], provider),
    TwindexPair: new ethers.Contract('0xC789F6C658809eED4d1769a46fc7BCe5dbB8316E',['function getReserves() public view returns (uint112 _reserve0, uint112 _reserve1, uint32 _blockTimestampLast)'], provider)
}

async function createProviders(){
    try {
        web3 = new Web3(new Web3.providers.HttpProvider(HTTP_PROVIDER_LINK));
        web3Ws = new Web3(new Web3.providers.WebsocketProvider(WEBSOCKET_PROVIDER_LINK));

        pancakeRouter = new web3.eth.Contract(PANCAKE_ROUTER_ABI, PANCAKE_ROUTER_ADDRESS);
        pancakeFactory = new web3.eth.Contract(PANCAKE_FACTORY_ABI, PANCAKE_FACTORY_ADDRESS);
        pancakeAbiDecoder.addABI(PANCAKE_ROUTER_ABI);

        twindexRouter = new web3.eth.Contract(TWINDEX_ROUTER_ABI, TWINDEX_ROUTER_ADDRESS);
        twindexFactory = new web3.eth.Contract(TWINDEX_FACTORY_ABI, TWINDEX_FACTORY_ADDRESS);
        twindexAbiDecoder.addABI(TWINDEX_ROUTER_ABI);

        return true;
    } catch (error) {
        console.error(error);
        return false;
    }
};

async function prepareBotSwap(){
    try{
        // Get user wallet from private key
        userWallet = web3.eth.accounts.privateKeyToAccount(PRIVATE_KEY);
        console.log(`***** Your Wallet Balance *****`.green);
        console.info(`Wallet Address:\t${userWallet.address}`.white);
        
        // Get token info
        tokenInfo1 = await getTokenInfo(TOKEN_ADDRESS, userWallet);
        if(tokenInfo1 != false){
            console.info(`${(tokenInfo1.balance/(10**tokenInfo1.decimals)).toFixed(10)}\t${tokenInfo1.symbol}`);
        }

        // Get stable token info
        tokenInfo2 = await getTokenInfo(STABLE_TOKEN_ADDRESS, userWallet);
        if(tokenInfo2 != false){
            console.info(`${(tokenInfo2.balance/(10**tokenInfo2.decimals)).toFixed(10)}\t${tokenInfo2.symbol}`);
        }

        // Get gas price info
        console.log(`***** Gas Price Information ***`.green);
        GAS_INFO = await getCurrentGasPrices();
        console.info(`High: ${GAS_INFO.high}\t Standard: ${GAS_INFO.standard}\t Low: ${GAS_INFO.low}\t Imediate: ${GAS_INFO.imediate}`);
        console.log(`*******************************`.green);

        return true;

    } catch (error) {
        console.error('Failed Prepare To swap');
        return false;
    }
};

async function getCurrentGasPrices(){
    try{
        return {low: 5, standard: 5, high: 5, imediate: 5};
        let response = await axios.get('https://bscgas.info/gas')
        let prices = {
        low: response.data.slow / 1,    
        standard: response.data.standard / 1,
        high: response.data.fast / 1,
        imediate: response.data.imediate / 1
        }
        return prices;
        //return {low: 5, standard: 5, high: 5, imediate: 5};
    } catch (error){
        console.error("Cannot get current gas prices");
        return {low: 0, standard: 0, high: 0, imediate: 0};
    };
}

async function getTokenInfo(tokenAddr, userWallet){
    try{
        var tokenAbi = 'https://api.bscscan.com/api?module=contract&action=getabi&address='+tokenAddr+'&apikey=WHDJ6NF7Q8XN4UEI1Z7HKFP46CZ3KAQQ6B';
        var response = await axios.get(tokenAbi);
        if(response.data.status == 0)
        {
            console.error('Invalid Token Address !')   
            return false;
        } else {
            let tokenAbiResult = response.data.result;
            let tokenContract = new web3.eth.Contract(JSON.parse(tokenAbiResult), tokenAddr);
            
            let balance = await tokenContract.methods.balanceOf(userWallet.address).call();
            let decimals = await tokenContract.methods.decimals().call();
            let symbol =  await tokenContract.methods.symbol().call();

            return {'address': tokenAddr, 'balance': balance, 'symbol': symbol, 'decimals': decimals, 'abi': tokenAbiResult, 'tokenContract': tokenContract}
        }
    } catch (error){
        console.error('Failed to get token info');
        console.error(error)
        return false;
    }
    
}

async function main(){

    // Starting create providers
    if (await createProviders() == false) {
        process.exit();
    }

    // Starting prepare infomation
    if (await prepareBotSwap() == false) {
        process.exit();
    }

    // Starting process
    let startingSwap = false;
    let currentDiff, currentPercentageDiff;
    let [currentBlockNumber, lastedSwapBlockNumber] = [0, 0];
    provider.on('block', async (blockNumber) => {
        const pancakeReserves = await Contract.PancakePair.getReserves();
        let at_pancake =  pancakeReserves[1] / pancakeReserves[0];
        console.log(`Pancake 1 DOP [${blockNumber}] = ${at_pancake} BUSD`.cyan);
        
        const twindexReserves = await Contract.TwindexPair.getReserves();
        let at_twindex =  twindexReserves[1] / twindexReserves[0];
        console.log(`Twindex 1 DOP [${blockNumber}] = ${at_twindex} BUSD`.green);
        
        //Calculate diff change
        if(!startingSwap){
            if(at_twindex > at_pancake){
                currentDiff = at_twindex-at_pancake; //Sell dopple on twindex, Buy dopple on pancake
                currentPercentageDiff = (currentDiff/at_pancake)*100
            } else if(at_twindex < at_pancake){
                currentDiff = at_pancake-at_twindex; //Sell dopple on pancake, Buy dopple on twindex
                currentPercentageDiff = (currentDiff/at_twindex)*100
            }
        }

        //Start swap
        if(startingSwap != true && ((currentDiff >= TRIGGER_DIFFERENT_PRICE) || (currentPercentageDiff >= TRIGGER_DIFFERENT_PRICE_PERCENTAGE))){
            startingSwap = true;
            currentBlockNumber = blockNumber;
            
            console.log(`Starting swap on [${currentBlockNumber}] = ${currentDiff} (${currentPercentageDiff.toFixed(4)}%) BUSD`.red);

            let fromAmount = ethers.utils.parseUnits(AMOUNT.toString(), 18)
            let [pancakeTokenResult, twindexTokenResult] = await Promise.all([triggerSwap(fromAmount, TOKEN_ADDRESS, STABLE_TOKEN_ADDRESS, pancakeRouter), triggerSwap(fromAmount, TOKEN_ADDRESS, STABLE_TOKEN_ADDRESS, twindexRouter)]);
            let [pancakeStableResult, twindexStableResult] = await Promise.all([triggerSwap(pancakeTokenResult[1], STABLE_TOKEN_ADDRESS, TOKEN_ADDRESS, pancakeRouter), triggerSwap(twindexTokenResult[1], STABLE_TOKEN_ADDRESS, TOKEN_ADDRESS, twindexRouter)]);
            let getNonce = await web3.eth.getTransactionCount(userWallet.address);
            if(pancakeTokenResult[1] < twindexTokenResult[1]){ // buy token on pancake and then buy busd on twindex // buy token pancake, sell token twindex
                console.log("Buy a token on pancake, sell a token on twindex".bgYellow);
                console.log(`Pancake [${fromAmount}] to [${pancakeTokenResult[1]}]`.bgYellow);
                console.log(`Twindex [${pancakeTokenResult[1]}] to [${twindexStableResult[1]}]`.bgYellow);
                let [transactionStatus1, transactionStatus2] = await Promise.all([
                    swapTokens(getNonce, userWallet, fromAmount, pancakeTokenResult[1], TOKEN_ADDRESS, STABLE_TOKEN_ADDRESS, PANCAKE_ROUTER_ADDRESS, pancakeRouter),
                    swapTokens(getNonce+1, userWallet, pancakeTokenResult[1], twindexStableResult[1], STABLE_TOKEN_ADDRESS, TOKEN_ADDRESS, TWINDEX_ROUTER_ADDRESS, twindexRouter)
                ]);
            } else { // buy token on twindex and then buy busd on pancake // buy token twindex, sell token pancake
                console.log("Buy a token on twindex, sell a token on pancake".bgYellow);
                console.log(`Twindex [${fromAmount}] to [${twindexTokenResult[1]}]`.bgYellow);
                console.log(`Pancake [${twindexTokenResult[1]}] to [${pancakeStableResult[1]}]`.bgYellow);
                let [transactionStatus1, transactionStatus2] = await Promise.all([
                    swapTokens(getNonce, userWallet, fromAmount, twindexTokenResult[1], TOKEN_ADDRESS, STABLE_TOKEN_ADDRESS, TWINDEX_ROUTER_ADDRESS, twindexRouter), 
                    swapTokens(getNonce+1, userWallet, twindexTokenResult[1], pancakeStableResult[1], STABLE_TOKEN_ADDRESS, TOKEN_ADDRESS, PANCAKE_ROUTER_ADDRESS, pancakeRouter)
                ]);
            }
            
            console.log(`Done [${blockNumber}]`.red);
            lastedSwapBlockNumber = currentBlockNumber;
            currentBlockNumber = 0;
            startingSwap = false;
        } else {
            console.log(`Waiting for swaping on blocknumber [${currentBlockNumber}]`.red);
        }

    });

}

async function triggerSwap(fromAmount, fromTokenAddress, toTokenAddress, poolRouter){

    /*
    // amountInToken is token to wallet address
    // amountOutMin is current price of token * SLIPPAGE_TOLERANCE (Output is estimated. You will receive at least)
    */
    let amountInToken = web3.utils.toHex(fromAmount);
    let amountOut = await poolRouter.methods.getAmountsOut(amountInToken, [fromTokenAddress, toTokenAddress]).call();
    let amountOutMin = (amountOut[1]-(amountOut[1]*SLIPPAGE_TOLERANCE/100)).toFixed(0);

    return [web3.utils.toHex(amountInToken), web3.utils.toHex(amountOutMin)];
}

async function swapTokens(nonce, userWallet, amountInToken, amountOutMin, fromTokenAddress, toTokenAddress, poolRouterAddress, poolRouter){
    let deadline, swap;

    let fromUserWallet = userWallet;
    let gasPrice = GAS_INFO.standard;
    let gasLimit = (200000).toString();

    await web3.eth.getBlock('latest', (error, block, result) => {
        deadline = block.timestamp + 300; // transaction expires in 300 seconds (5 minutes)
        deadline = web3.utils.toHex(deadline);
    });

    swap = poolRouter.methods.swapExactTokensForTokens(amountInToken.toString(), amountOutMin.toString(), [fromTokenAddress, toTokenAddress], fromUserWallet.address, deadline);
    let encodedABI = swap.encodeABI();
    
    let hexNonce = web3.utils.toHex(nonce);
    let tx = {
        nonce: hexNonce,
        from: fromUserWallet.address,
        to: poolRouterAddress,
        gas: gasLimit,
        gasPrice: gasPrice*ONE_GWEI,
        data: encodedABI,
        value: 0*10**18
    }

    let signedTx = await fromUserWallet.signTransaction(tx);
    console.log('====signed transaction=====', gasLimit, gasPrice)
    await web3.eth.sendSignedTransaction(signedTx.rawTransaction)
    .on('transactionHash', function(hash){
        console.log('Transaction Hash : ', hash);
    })
    .on('confirmation', function(confirmationNumber, receipt){
        return true;
    })
    .on('receipt', function(receipt){
        console.error(receipt);
        return false;
    })
    .on('error', function(error, receipt) {
        console.log('Transaction failed.');
        return false;
    });
}


main();
