# CMPE483 Homework 1 

- Kağan Sarı - 2011400207
- Sevda Çopur - 2012400054
- Mahmut Uğur Taş - 2017700132




__Note:__ An extended version of this documentation is also available in the root directory as "Report.pdf".


## Installation

```sh
# install dependencies truffle and ganache-cli
npm install
# start ethereum testrpc on 127.0.0.1:8545
./node_modules/.bin/ganache-cli
# simulate contract for 2 rounds
# (period is 50 blocks, can be changed on migrations/2_deploy_contracts.js)
./node_modules/.bin/truffle test
```



## Assumptions

- Period can be optional. We decided to define period of the lottery as the parameter `_period` in constructor function. This way we can simulate the life cycle of the contract much faster. Period is given by deployer and must be divisible by 2 since each stage is half-period.
- At least 3 participants are required. Otherwise reward is added back to the balances of participants. They can withdraw their money afterwards.
- One ticket can win multiple times in a round. Winners are choosen by XOR'ing the revealed numbers and the last 3 numbers decide the indexes of winner tickets, but same ticket can be choosen twice or thrice. We ignored this situation because it would have disrupted the randomness in selection of winners.
- Payout function can be called implicitly, meaning that if round ends but `payout` function is not called and winners are not selected then it is called in `checkPayout` modifier when someone tries to buy ticket in the next round. Cost of the function is unpredictable because of the for loops. It would consume too much gas on a large scale. A workaround would be to block submission functions and force user to call payout function explicitly.
- Someone buys ticket in every round. This is an extreme case. For example if nobody plays the game for whole 3 rounds, then `payout`  function should be called and the contract should iterate 3 periods. If someone tries to buy ticket in this state, her money will be returned 3 times until the contract catch up with up-to-date block.



## Implementation

The project consists of 2 main parts. One is the solidity contract `contracts/Lottery.sol`, and the other is the javascript test file `test/lottery.js`. We have 2 dependencies defined in `package.json`, truffle and ganache-cli. The test code connects to the network defined in `truffle.js`  which is the default network that is run by `ganache-cli`. The other files belong to truffle framework and `migrations/2_deploy_contracts.js` is used to deploy the contract to the connected network with period of 50 blocks.

After the contract is deployed to the network, it immediately starts to run in submission stage. Only available function is `purchaseTicket` during this stage. Stage control is performed by modifiers like `inSubmission` and `inReveal`.  Buyers send ticket fee in ether to this function together with their hash. Hashes are calculated outside of the blockchain, giving the concatenation of random number generated by user and the address of the user as input to `keccak` (`sha3`) function . For each puchase, a new instance of `Ticket` struct is created having relevant properties of the ticket. Tickets are stored in state variable as mapping with hashes as keys. Hashes are also stored in another array to be used later to delete mapping values starting a new round. Sent values are also added directly to the `reward` as a state variable.

Contract automatically switches to reveal state after half-period of blocks mined. Submission is not allowed this time. Ticket owners submit the random numbers they generated when bought their tickets calling `submitNumber` function. Contract validates the number hashing it together with the address of the sender of the message, sets necessary properties of the ticket like `number` and `submitted` flag.  Then the ticket is pushed to another state variable array `tickets` which contains submitted ones.

After period ends, a new round starts and contract waits for `payout` function to be called. If the function is not called but a user tries to buy a new ticket in the new round, then `payout` function is called by `checkPayout` modifier. `payout` function checks the submitted tickets. If the length is less than 3, money is shared among the ones who submitted their numbers accordingly. Else, all numbers are XOR'ed and the last 3 random numbers correspond to the winner tickets. The XOR'ed number modulus the length of the submitted  tickets array become the index of the winning ticket in the array. Winner numbers are also hold in another state variable `winnerNumbers` for further use. Their rewards are calculated according to the type of their tickets and their rank. Prizes are added to the values in `balances` state variable accordingly. After all values related to the reward are set, `restart` function is called. It starts a new round deleting used state variables. Thereafter, contract is ready to accept users to purchase new tickets and so on.



## Test

Test script `lottery.js` runs the lottery 2 times successively. Randomly generated tickets are submitted with their hashes to the contract. Invalid tickets, invalid ticket prices, reveal and payout functions are tested to throw error here. Total reward is expected to equal to sum of ticket fees. Then EVM is mined until half of the period with `eve_mine` RPC method __which is only available in ganache__ (formerly ethereum-testrpc). Then the numbers of previously generated tickets are submitted. Invalid numbers, trial to reveal again, submission and payout functions are tested to throw errors here. After payout is done, Calculation of rewards and balances of winner accounts are tested with corresponding values computed in javascript. Thereafter, same operations are performed for the subsequent round in order to validate there is no error on clearing contract state.Example outputs of `ganache-cli` and `truffle test`  can be found in `example-outputs` folder

