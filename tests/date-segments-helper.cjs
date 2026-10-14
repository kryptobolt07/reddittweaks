// Enter dates through the same editable fields as a person using the picker.
function setDateSegments(root,bound,value){
  const W=root.ownerDocument.defaultView,[year,month,day]=value.split('-');
  for(const [part,text]of Object.entries({day,month,year})){
    const input=root.querySelector(`input[data-bound="${bound}"][data-part="${part}"]`);
    if(!input)throw Error('Missing '+bound+' '+part);
    input.focus();input.value=text;input.dispatchEvent(new W.Event('input',{bubbles:true}));input.blur();
  }
}
function setDateMode(root,mode){root.querySelector('.date-condition').click();root.querySelector(`[data-mode="${mode}"]`).click();}
module.exports={setDateSegments,setDateMode};
