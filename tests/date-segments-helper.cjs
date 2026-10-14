// Drive the restored calendar through its month/year/day buttons.
// Keep the helper name for the existing search integration fixtures.
function setDateSegments(root,bound,value){
  const [year,month]=value.split('-').map(Number);
  root.querySelector('.calendar-year').click();
  const yearOption=root.querySelector(`[data-year="${year}"]`);
  if(!yearOption)throw Error('Missing calendar year '+year);
  yearOption.click();root.querySelector('.calendar-month').click();
  root.querySelector(`[data-month="${month-1}"]`).click();
  root.querySelector(`[data-date="${value}"]`).click();
}
function setDateMode(root,mode){root.querySelector(`[data-mode="${mode}"]`).click();}
module.exports={setDateSegments,setDateMode};
