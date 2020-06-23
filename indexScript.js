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

bpTile.addEventListener("mouseover", function () {
	transition.classList.remove("active");
	transition.classList.add("beerpongBG");
	tileHover = true;
});
bpTile.addEventListener("mouseout", function () {
	if(!tileClickColorChange){
		if(topInt >= 50){
		transition.classList.add("active");
		textChange.classList.add("active");
		}
		transition.classList.remove("beerpongBG");
		tileHover = false;
	}
});

influenceTile.addEventListener("mouseover", function () {
	transition.classList.remove("active");
	transition.classList.add("influenceBG");
	tileHover = true;
});
influenceTile.addEventListener("mouseout", function () {
	if(!tileClickColorChange){
		if(topInt >= 50){
			transition.classList.add("active");
			textChange.classList.add("active");
			}
		transition.classList.remove("influenceBG");
		tileHover = false;
	}
});

githubTile.addEventListener("mouseover", function () {
	transition.classList.remove("active");
	transition.classList.add("githubBG");
	tileHover = true;
});
githubTile.addEventListener("mouseout", function () {
	if(!tileClickColorChange){
		if(topInt >= 50){
			transition.classList.add("active");
			textChange.classList.add("active");
			}
		transition.classList.remove("githubBG");
		tileHover = false;
	}
});

codepenTile.addEventListener("mouseover", function () {
	transition.classList.remove("active");
	transition.classList.add("codepenBG");
	tileHover = true;
});
codepenTile.addEventListener("mouseout", function () {
	if(!tileClickColorChange){
		if(topInt >= 50){
			transition.classList.add("active");
			textChange.classList.add("active");
			}
		transition.classList.remove("codepenBG");
		tileHover = false;
	}
});

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

var collPhoto = document.getElementsByClassName("collapsiblePhoto");
var photoClass = document.getElementsByClassName("photoTile");
var i;

function isolatePhoto(clickedId){

	var contentHeight = document.getElementById("content").getBoundingClientRect().height - 100;
	
	for(var i = 0; i < photoClass.length; i++){
		photoClass[i].style.display = "none";
	};


	var infoId = document.getElementById(clickedId + "Info");
	infoId.style.display = "block";
	

	infoId.style.minHeight = contentHeight + "px";
	

	tileClickColorChange=true;

}

function showPhoto(clickedId){

	bpTile.style.animationDelay = "calc(1 * var(--stagger-delay))";
	influenceTile.style.animationDelay = "calc(1 * var(--stagger-delay))";
	githubTile.style.animationDelay = "calc(1 * var(--stagger-delay))";
	codepenTile.style.animationDelay = "calc(1 * var(--stagger-delay))";
	
	for(var i = 0; i < photoClass.length; i++){
		photoClass[i].style.display = "block";
	};

	var infoId = document.getElementById(clickedId);
	infoId.style.display = "none";

	// turn off the chosen tile background color
	transition.classList.add("active");
	textChange.classList.add("active");
	transition.classList.remove(clickedId.substring(0, clickedId.length - 4) + "BG");


	tileClickColorChange=false;
	tileHover = false;
}
	

