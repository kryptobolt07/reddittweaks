// Enter dates through the same editable fields as a person using the picker.
function setDateSegments(root,bound,value){
  const [year,month,day]=value.split('-'),W=root.ownerDocument.defaultView;
  for(const [part,text]of Object.entries({day,month,year})){
    const input=root.querySelector(`input[data-bound="${bound}"][data-part="${part}"]`);
    if(!input)throw Error('Missing '+bound+' '+part);input.focus();input.value=text;input.dispatchEvent(new W.Event('input',{bubbles:true}));
  }
  // Leave the final editable dropdown, as when tabbing to Apply.
  root.querySelector(`input[data-bound="${bound}"][data-part="year"]`).blur();
}
function setDateMode(root,mode){root.querySelector('.date-condition').click();root.querySelector(`[data-mode="${mode}"]`).click();}
module.exports={setDateSegments,setDateMode};
