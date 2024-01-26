function countNumberArrayTotal(array: number[]) {
  return array.reduce((sum: number, currentValue: number) => {
    return sum + currentValue;
  });
}

function createRevertMessageDueToMissingRole(address: string, role: string) {
  return `AccessControl: account ${address.toLowerCase()} is missing role ${role.toLowerCase()}`;
}

export { countNumberArrayTotal, createRevertMessageDueToMissingRole };
