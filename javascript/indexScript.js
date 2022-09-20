const transition = document.querySelector("#bgtransition");
const textChange = document.querySelector(".textColorChange");

const bpTile = document.getElementById("beerpong");
const influenceTile = document.getElementById("influence");
const githubTile = document.getElementById("github");
const codepenTile = document.getElementById("codepen");

var tileHover = false;
var tileClickColorChange = false;


// preload images
var beerpong = new Image();
beerpong.src =
	"https://www.dropbox.com/s/9duz6trkjf6vur5/BPStorePhoto.png?dl=1";
var influence = new Image();
influence.src = "https://www.dropbox.com/s/2fh5vcg5seg258g/Influence.png?dl=1";
var github = new Image();
github.src = "https://www.dropbox.com/s/l9oksz1oz8d1e9d/github.png?dl=1";
var codepen = new Image();
codepen.src = "https://www.dropbox.com/s/u85vyigz7e7w6sh/codepen.png?dl=1";

var topInt;

// start screen color change from black to white
// background and header text
window.onscroll = function () {
	var top = window.pageYOffset;
	topInt = top;
	if(!tileHover){
		if (top >= 50 ) {
			transition.classList.add("active");
			textChange.classList.add("active");
		} else {
			transition.classList.remove("active");
			textChange.classList.remove("active");
		}
	}
	
};

var coll = document.getElementsByClassName("collapsible");
var i;

// contact button collapsible
for (i = 0; i < coll.length; i++) {
  coll[i].addEventListener("click", function() {
    this.classList.toggle("active");
    var content = this.nextElementSibling;
    if (content.style.maxHeight){
      content.style.maxHeight = null;
    } else {
      content.style.maxHeight = content.scrollHeight + "px";
    } 
  });
}
