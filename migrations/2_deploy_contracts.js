var Lottery = artifacts.require("./Lottery.sol");

module.exports = function(deployer, network, addresses) {
  deployer.deploy(Lottery, 50);
};
