const Lottery = artifacts.require('./Lottery.sol');

let accounts; // accounts defined by test rpc
let c; // deployed contract instance

/**
 * return current block number asynchronously
 * @return {integer}
 */
const getBlockNumber = () => {
  return new Promise((resolve) => {
    web3.eth.getBlockNumber((err, blockNum) => resolve(blockNum));
  })
};

/**
 * mine {blocksNum} blocks
 * @param  {integer} blocksNum
 */
const skipBlocks = async (blocksNum) => {
  for (var i = 0; i < blocksNum; i++) {
    web3.currentProvider.send({
      jsonrpc: "2.0",
      method: "evm_mine",
      id: 12345
    });
  }
};

/**
 * mine until {blockNumber}
 * @param  {integer} blockNumber
 */
const skipBlocksUntil = async (blockNumber) => {
  const currentBlockNum = await getBlockNumber();
  skipBlocks(blockNumber - currentBlockNum);
};

/**
 * create {size} tickets with random types and numbers
 * @param  {integer} size
 * @return {[object]}
 */
const generateTickets = async (size) => {
  const tickets = [];
  const ticketPrices = [8, 4, 2].map(num => Number(web3.toWei(num, 'finney')));

  for (var i = 0; i < size; i++) {
    const number = Math.floor(Math.random(1e15)*1e15);
    const price = ticketPrices[Math.floor(Math.random()*3)];
    const account = accounts[i % accounts.length];
    const hash = (await c.keccak.call(number, { from: account })).toString();
    tickets.push({ number, hash, account, price });
  }
  return tickets;
}

/**
 * call contract function to buy given {tickets}
 * @param  {[object]} tickets
 */
const purchaseTickets = async (tickets) => {
  await Promise.all(
    tickets.map((ticket) => {
      return c.purchaseTicket.sendTransaction(ticket.hash, { from: ticket.account, value: ticket.price });
    })
  );
};

/**
 * call contract function to submit numbers for given {tickets}
 * @param  {[object]} tickets
 */
const submitNumbers = async (tickets) => {
  await Promise.all(
    tickets.map((ticket) => {
      return c.submitNumber.sendTransaction(ticket.number, { from: ticket.account});
    })
  );
};

/**
 * return true if a promise function throws an error, false otherwise
 * @param  {Promise} promise
 * @return {boolean}
 */
const throwed = async (promise, ...args) => {
  try {
    await promise(...args);
    return false;
  } catch(e) {
    return true;
  }
};

/**
 * return type of a ticket as string according to price of it
 * @param  {object} ticket
 * @return {string} full|half|quarter
 */
const getTicketType = (ticket) => {
  const price = web3.fromWei(ticket.price, 'finney');
  if(price == 8) return 'full';
  if(price == 4) return 'half';
  if(price == 2) return 'quarter';
  throw Error('invalid ticket');
}

/**
 * take winner tickets, calculate expected rewards and return a balance object
 * @param  {[integer]} winnerNumbers
 * @param  {[object]}  tickets
 * @param  {integer}   expectedTotalReward (might include reward from previous rounds)
 * @return {object}    {address: integer}
 */
const getExpectedBalancesFromNumbers = (winnerNumbers, tickets, expectedTotalReward) => {
  // find winner tickets
  const winnerTickets = winnerNumbers.map((num) => {
    const ticket = tickets.find(ticket => ticket.number == num);
    expect(ticket).not.to.be.undefined;
    return Object.assign({}, ticket); // same ticket can win multiple times
  });

  // calculate rewards winner should earn
  winnerTickets.forEach((ticket, i) => {
    let reward = expectedTotalReward / (2 ** (i + 1));
    if(getTicketType(ticket) == 'half') reward /= 2;
    if(getTicketType(ticket) == 'quarter') reward /= 4;
    ticket.expectedReward = reward;
  });

  const balances = {};

  // assign balances
  for(let ticket of winnerTickets) {
    if(!balances[ticket.account]) balances[ticket.account] = 0;
    balances[ticket.account] += ticket.expectedReward;
  }

  return balances;
};

/**
 * take a balances object and create same object from the contract
 * @param  {object} expectedBalances {address: integer}
 * @return {object}                  {address: integer}
 */
const getActualBalancesFromExpectedOnes = async (expectedBalances) => {
  const actualBalances = {};
  await Promise.all(Object.keys(expectedBalances).map(async (account) => {
    actualBalances[account] = (await c.balances.call(account)).toNumber();
  }));
  return actualBalances;
};

/**
 * test if balances and rewards in the contract are calculated right
 * @param  {[object]} tickets
 * @param  {integer}  expectedTotalReward
 */
const testRewards = async (tickets, expectedTotalReward) => {
  const winnerNumbers = (await c.getWinnerNumbers.call()).map(n => n.toNumber());

  // compare balances
  const expectedBalances = getExpectedBalancesFromNumbers(winnerNumbers, tickets, expectedTotalReward);
  const actualBalances = await getActualBalancesFromExpectedOnes(expectedBalances);
  expect(expectedBalances).to.deep.equal(actualBalances);

  // compare expected reward and the reward fetched from contract
  const totalBalance = Object.values(actualBalances).reduce((sum, balance) => sum += balance, 0);
  const leftReward = (await c.reward.call()).toNumber();

  expect(expectedTotalReward).to.equal(leftReward + totalBalance)

  // reset balances in the contract
  await Promise.all(Object.keys(actualBalances).map(async (account) => {
    await c.withdrawal.sendTransaction({ from: account });
  }));
};

contract('Lottery', async (_accounts) => {
  accounts = _accounts;

  it('should run 2 lotteries successively', async () => {
    c = await Lottery.deployed();
    const period = (await c.period.call()).toNumber();
    let lastStartBlock = (await c.lastStartBlock.call()).toNumber();
    let submissionEndBlockNum = lastStartBlock + period/2;
    let revealEndBlockNum = lastStartBlock + period;
    console.log(`Lottery starting at block ${lastStartBlock}, submitting until ${submissionEndBlockNum}, revealing until ${revealEndBlockNum}`);

    const firstRoundTickets = await generateTickets(20);
    const testTickets = await generateTickets(1);

    /********************
    * FIRST HALF-PERIOD *
    ********************/
    await purchaseTickets(firstRoundTickets);

    // check reward
    let expectedTotalReward = firstRoundTickets.reduce((sum, ticket) => sum + ticket.price, 0);
    expect((await c.reward.call()).toNumber()).to.equal(expectedTotalReward);

    // cannot reveal or payout in submission state
    expect(await throwed(c.payout.call)).to.be.true;
    expect(await throwed(c.submitNumber.call, firstRoundTickets[0])).to.be.true;
    // cannot buy ticket with invalid price
    expect(await throwed(c.purchaseTicket.call, 8324)).to.be.true;
    // cannot buy same tickets again
    expect(await throwed(purchaseTickets, firstRoundTickets.slice(0, 1))).to.be.true;

    console.log(`${firstRoundTickets.length} tickets bought, submissions ending`);
    /*********************
    * SECOND HALF-PERIOD *
    *********************/
    await skipBlocksUntil(submissionEndBlockNum);
    await submitNumbers(firstRoundTickets);

    // cannot buy tickets or payout in reveal stage
    expect(await throwed(purchaseTickets, testTickets)).to.be.true;
    expect(await throwed(c.payout.call)).to.be.true;
    // cannot submit with incorrect number
    expect(await throwed(c.submitNumber.sendTransaction, 51373)).to.be.true;
    // cannot re-submit
    expect(await throwed(submitNumbers, firstRoundTickets.slice(0, 1))).to.be.true;

    console.log(`${firstRoundTickets.length} numbers submitted, reveals ending`);

    /*********************
    * THIRD HALF-PERIOD  *
    *********************/
    await skipBlocksUntil(revealEndBlockNum);
    await c.payout.sendTransaction();

    await testRewards(firstRoundTickets, expectedTotalReward);

    // NEW ROUND STARTING HERE
    console.log(`First round ended with ${web3.fromWei(expectedTotalReward)} ethers successfully`);
    const leftReward = (await c.reward.call()).toNumber();

    lastStartBlock = (await c.lastStartBlock.call()).toNumber();
    submissionEndBlockNum = lastStartBlock + period/2;
    revealEndBlockNum = lastStartBlock + period;
    console.log(`New round starting at block ${lastStartBlock}, submitting until ${submissionEndBlockNum}, revealing until ${revealEndBlockNum}`);

    secondRoundTickets = await generateTickets(7);
    await purchaseTickets(secondRoundTickets);

    // check reward
    expectedTotalReward = leftReward + secondRoundTickets.reduce((sum, ticket) => sum + ticket.price, 0);

    expect((await c.reward.call()).toNumber()).to.equal(expectedTotalReward);
    console.log(`${secondRoundTickets.length} tickets bought, submissions ending`);

    /********************
    * FORTH HALF-PERIOD *
    ********************/
    await skipBlocksUntil(submissionEndBlockNum);
    await submitNumbers(secondRoundTickets);
    console.log(`${secondRoundTickets.length} numbers submitted, reveals ending`);

    /********************
    * FIFTH HALF-PERIOD *
    ********************/
    await skipBlocksUntil(revealEndBlockNum);
    await c.payout.sendTransaction();
    await testRewards(secondRoundTickets, expectedTotalReward);
    console.log(`Second round ended with ${web3.fromWei(expectedTotalReward)} ethers successfully`);
  });
});